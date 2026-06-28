/**
 * POST /api/paper — forward / paper-trade signal check (spec §9).
 *
 * Body: { spec }. Validates the spec with parseSpec + validateSpec exactly like
 * /api/validate, fetches candles once per ticker over the spec's range/timeframe,
 * runs `computeForwardState` (which runs the SAME engine as the backtest — no
 * logic fork), and returns the `ForwardState`.
 *
 * 400 on a bad spec; 502 when market data is unavailable. Mirrors the validate /
 * optimize routes' error handling.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Candle, StrategySpec } from '$lib/types';
import { parseSpec, validateSpec, hasErrors } from '$lib/validation';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import { fetchCandles } from '$lib/server/fmp/client';
import { computeForwardState } from '$lib/server/paper';

/** Parse + semantically validate a spec, throwing 400 on failure (mirrors /api/validate). */
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

/** Fetch candles once per ticker for a universe (same loop/error handling as /api/validate). */
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

export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}
	if (!body || typeof body !== 'object') {
		throw error(400, { message: 'Expected { spec }.' });
	}
	const { spec } = body as { spec?: unknown };

	const base = parseBaseSpec(spec);
	const candlesByTicker = await fetchUniverseCandles(base, fetch);
	return json(computeForwardState(base, candlesByTicker));
};
