/**
 * POST /api/backtest — the heart of the app.
 *
 * Validate the incoming spec (structural zod + semantic capabilities), fetch
 * candles for every ticker over the universe range/timeframe, run the pure
 * engine, persist the run, and return the `BacktestResult`. The backend is the
 * single source of truth for all indicator and P&L math.
 */

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import type { Candle, StrategySpec } from '$lib/types';
import { parseSpec, validateSpec, hasErrors } from '$lib/validation';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import { fetchCandles } from '$lib/server/fmp/client';
import { runBacktest } from '$lib/server/engine/engine';
import { computeBenchmark } from '$lib/server/engine/benchmark';
import { FmpPitProvider } from '$lib/server/universe/fmp-pit';
import { selectUniverseSymbols } from '$lib/server/universe/select';
import { fetchSectors, type SectorMap } from '$lib/server/universe/sectors';
import { FMP_KEY, getSetting, saveRun } from '$lib/server/db/repository';

/** Default and hard cap for index-resolved universes (keeps fetch fan-out sane). */
const DEFAULT_MAX_SYMBOLS = 25;
const HARD_MAX_SYMBOLS = 50;

/**
 * Resolve the active FMP key exactly like the FMP client / universe route do: a
 * UI-saved key (DB) takes precedence over the env var. Server-only.
 */
function resolveFmpKey(): string | null {
	return getSetting(FMP_KEY) ?? env.FMP_API_KEY ?? null;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}

	const parsed = parseSpec(body);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		const where = first?.path?.length ? ` at ${first.path.join('.')}` : '';
		throw error(400, { message: `Invalid strategy${where}: ${first?.message ?? 'unknown error'}` });
	}
	const spec = parsed.data;

	const issues = validateSpec(spec, CAPABILITIES);
	if (hasErrors(issues)) {
		const errs = issues.filter((i) => i.severity === 'error');
		const summary = errs
			.slice(0, 3)
			.map((i) => `${i.path}: ${i.message}`)
			.join('; ');
		const more = errs.length > 3 ? ` (+${errs.length - 3} more)` : '';
		throw error(400, {
			message: `The strategy has validation errors — ${summary}${more}`
		});
	}

	const { from, to } = spec.universe.dateRange;

	// Resolve the run's ticker set. By default this is the explicit
	// `universe.tickers`; when the source is an INDEX we replace it with the
	// point-in-time members over the run window (survivorship-free, leak-safe:
	// the provider only ever replays membership as of the window, never today's).
	const warnings: string[] = [];
	let runSpec: StrategySpec = spec;

	if (spec.universe.source?.kind === 'index') {
		const source = spec.universe.source;
		const apiKey = resolveFmpKey();
		if (!apiKey) {
			throw error(502, {
				message:
					'Index universe needs an FMP API key, but none is configured. Add it in Settings (or set FMP_API_KEY).'
			});
		}
		const requested = source.maxSymbols ?? DEFAULT_MAX_SYMBOLS;
		const maxSymbols = Math.max(1, Math.min(requested, HARD_MAX_SYMBOLS));

		let resolved: string[] = [];
		try {
			const provider = new FmpPitProvider({ apiKey, index: source.index });
			const { membership, gaps } = await provider.resolve(from, to, fetch);
			const selection = selectUniverseSymbols(membership, from, to, maxSymbols);
			resolved = selection.symbols;
			if (selection.capped) {
				warnings.push(
					`Index "${source.index}" resolved to more than ${maxSymbols} members over ${from}..${to}; ` +
						`capped to the first ${maxSymbols} (sorted) for this run.`
				);
			}
			if (gaps.length > 0) {
				warnings.push(
					`Universe coverage gaps for index "${source.index}": ` +
						gaps.map((g) => g.detail).join(' ')
				);
			}
		} catch (e) {
			warnings.push(
				`Index universe resolution failed (${e instanceof Error ? e.message : 'unknown error'}); ` +
					`falling back to the explicit ticker list.`
			);
		}

		if (resolved.length === 0) {
			// Nothing resolved — fall back to the explicit tickers as a seed.
			const fallback = [...new Set(spec.universe.tickers.map((t) => t.trim()).filter(Boolean))];
			warnings.push(
				`Index "${source.index}" yielded no point-in-time members for ${from}..${to}; ` +
					(fallback.length
						? 'using the explicit ticker list instead.'
						: 'and no explicit tickers were provided.')
			);
			resolved = fallback;
		}

		// Reflect the actual tickers used in the spec the engine + audit see.
		runSpec = { ...spec, universe: { ...spec.universe, tickers: resolved } };
	}

	// Fetch candles per ticker (deduplicated, order-preserving).
	const uniqueTickers = [...new Set(runSpec.universe.tickers.map((t) => t.trim()).filter(Boolean))];
	const candlesByTicker: Record<string, Candle[]> = {};
	try {
		for (const ticker of uniqueTickers) {
			candlesByTicker[ticker] = await fetchCandles(
				{
					symbol: ticker,
					timeframe: runSpec.universe.timeframe,
					from,
					to,
					session: runSpec.universe.session
				},
				fetch
			);
		}
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Market data unavailable.';
		throw error(502, { message: `Market data unavailable: ${message}` });
	}

	// §4c Sector exposure cap: when configured, resolve a symbol→sector map for the
	// run's tickers (same FMP key resolution as the index/universe path) BEFORE the
	// engine. Failure is graceful and non-fatal — push a warning and run without the
	// cap (the engine also warns once if it then finds no sector for a candidate).
	let sectors: SectorMap | undefined;
	if (runSpec.risk.maxPositionsPerSector !== undefined) {
		const apiKey = resolveFmpKey();
		if (!apiKey) {
			warnings.push(
				'Sector exposure cap is configured but no FMP API key is available; ' +
					'running without the cap. Add a key in Settings (or set FMP_API_KEY).'
			);
		} else {
			try {
				const resolved = await fetchSectors(uniqueTickers, apiKey, fetch);
				sectors = resolved.sectors;
				if (resolved.gaps.length > 0) {
					warnings.push(
						'Sector data coverage gaps (cap not enforced for affected symbols): ' +
							resolved.gaps.map((g) => g.detail).join(' ')
					);
				}
			} catch (e) {
				warnings.push(
					`Sector data fetch for the sector cap failed (${e instanceof Error ? e.message : 'unknown error'}); ` +
						'running without the cap.'
				);
			}
		}
	}

	const result = runBacktest(runSpec, candlesByTicker, { sectors });

	// Surface universe-resolution warnings (capping, gaps, fallbacks) on the run.
	if (warnings.length > 0) result.warnings.unshift(...warnings);

	// Optional buy-and-hold benchmark overlay (failure is non-fatal).
	const benchmarkSymbol = runSpec.universe.benchmark?.trim();
	if (benchmarkSymbol) {
		try {
			const benchmarkCandles = await fetchCandles(
				{
					symbol: benchmarkSymbol,
					timeframe: runSpec.universe.timeframe,
					from,
					to,
					session: runSpec.universe.session
				},
				fetch
			);
			result.benchmark = computeBenchmark(
				benchmarkSymbol,
				benchmarkCandles,
				runSpec.risk.initialCapital
			);
		} catch (e) {
			result.warnings.push(
				`Benchmark "${benchmarkSymbol}" unavailable: ${e instanceof Error ? e.message : 'fetch failed'}.`
			);
		}
	}

	saveRun({ result });
	return json(result);
};
