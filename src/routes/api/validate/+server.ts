/**
 * POST /api/validate — strategy trust gates (spec §6).
 *
 * Body is either:
 *   { kind: 'single', spec }                              — DSR + Monte-Carlo for one run.
 *   { kind: 'optimization', spec: OptimizationSpec, maxCombos? } — full grid + DSR/PBO/plateau.
 *
 * Validates the (base) spec with parseSpec + validateSpec exactly like /api/optimize,
 * fetches candles once for the universe, then runs validateSingle / validateOptimization
 * and returns the `ValidationReport`. Mirrors the optimize route's 400 / 502 handling.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Candle, OptimizationSpec, OptimizeParam, StrategySpec } from '$lib/types';
import { parseSpec, validateSpec, hasErrors } from '$lib/validation';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import { fetchCandles } from '$lib/server/fmp/client';
import { validateSingle, validateOptimization } from '$lib/server/validation/report';

/** Parse + semantically validate a base spec, throwing 400 on failure (mirrors /api/optimize). */
function parseBaseSpec(base: unknown): StrategySpec {
	const parsed = parseSpec(base);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		const where = first?.path?.length ? ` at ${first.path.join('.')}` : '';
		throw error(400, { message: `Invalid strategy${where}: ${first?.message ?? 'unknown error'}` });
	}
	const spec = parsed.data;
	const issues = validateSpec(spec, CAPABILITIES);
	if (hasErrors(issues)) {
		const summary = issues
			.filter((i) => i.severity === 'error')
			.slice(0, 3)
			.map((i) => `${i.path}: ${i.message}`)
			.join('; ');
		throw error(400, { message: `The strategy has validation errors — ${summary}` });
	}
	return spec;
}

/** Fetch candles once per ticker for a universe (same loop/error handling as /api/optimize). */
async function fetchUniverseCandles(
	spec: StrategySpec,
	fetch: typeof globalThis.fetch
): Promise<Record<string, Candle[]>> {
	const { from, to } = spec.universe.dateRange;
	const uniqueTickers = [...new Set(spec.universe.tickers.map((t) => t.trim()).filter(Boolean))];
	const candlesByTicker: Record<string, Candle[]> = {};
	try {
		for (const ticker of uniqueTickers) {
			candlesByTicker[ticker] = await fetchCandles(
				{
					symbol: ticker,
					timeframe: spec.universe.timeframe,
					from,
					to,
					session: spec.universe.session
				},
				fetch
			);
		}
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Market data unavailable.';
		throw error(502, { message: `Market data unavailable: ${message}` });
	}
	return candlesByTicker;
}

/** Validate the param grid (mirrors /api/optimize). */
function parseParams(params: unknown, spec: StrategySpec): OptimizeParam[] {
	if (!Array.isArray(params) || params.length === 0) {
		throw error(400, { message: 'Provide at least one parameter to optimize.' });
	}
	const cleanParams: OptimizeParam[] = [];
	for (const p of params) {
		if (!p || typeof p !== 'object') {
			throw error(400, { message: 'Each param must be { indicatorId, param, values }.' });
		}
		const { indicatorId, param, values } = p as Record<string, unknown>;
		if (
			typeof indicatorId !== 'string' ||
			typeof param !== 'string' ||
			!Array.isArray(values) ||
			values.length === 0 ||
			values.some((v) => typeof v !== 'number' || !Number.isFinite(v))
		) {
			throw error(400, { message: 'Each param needs { indicatorId, param, values: number[] }.' });
		}
		if (!spec.indicators.some((i) => i.id === indicatorId)) {
			throw error(400, { message: `Unknown indicator instance "${indicatorId}".` });
		}
		cleanParams.push({ indicatorId, param, values: values as number[] });
	}
	return cleanParams;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}
	if (!body || typeof body !== 'object') {
		throw error(400, {
			message: "Expected { kind: 'single' | 'optimization', spec, maxCombos? }."
		});
	}
	const { kind, spec, maxCombos } = body as {
		kind?: unknown;
		spec?: unknown;
		maxCombos?: unknown;
	};

	if (kind === 'single') {
		const base = parseBaseSpec(spec);
		const candlesByTicker = await fetchUniverseCandles(base, fetch);
		return json(validateSingle(base, candlesByTicker));
	}

	if (kind === 'optimization') {
		if (!spec || typeof spec !== 'object') {
			throw error(400, { message: 'Expected { base, params, sortMetric? } for an optimization.' });
		}
		const { base, params, sortMetric } = spec as {
			base?: unknown;
			params?: unknown;
			sortMetric?: unknown;
		};
		const baseSpec = parseBaseSpec(base);
		const cleanParams = parseParams(params, baseSpec);
		const candlesByTicker = await fetchUniverseCandles(baseSpec, fetch);

		const optSpec: OptimizationSpec = {
			base: baseSpec,
			params: cleanParams,
			sortMetric: typeof sortMetric === 'string' ? sortMetric : undefined
		};
		const cap =
			typeof maxCombos === 'number' && Number.isFinite(maxCombos) && maxCombos > 0
				? Math.floor(maxCombos)
				: undefined;
		return json(
			cap === undefined
				? validateOptimization(optSpec, candlesByTicker)
				: validateOptimization(optSpec, candlesByTicker, cap)
		);
	}

	throw error(400, { message: "\"kind\" must be 'single' or 'optimization'." });
};
