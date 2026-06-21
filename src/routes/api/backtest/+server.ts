/**
 * POST /api/backtest — the heart of the app.
 *
 * Validate the incoming spec (structural zod + semantic capabilities), fetch
 * candles for every ticker over the universe range/timeframe, run the pure
 * engine, persist the run, and return the `BacktestResult`. The backend is the
 * single source of truth for all indicator and P&L math.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Candle } from '$lib/types';
import { parseSpec, validateSpec, hasErrors } from '$lib/validation';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import { fetchCandles } from '$lib/server/fmp/client';
import { runBacktest } from '$lib/server/engine/engine';
import { saveRun } from '$lib/server/db/repository';

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

	// Fetch candles per ticker (deduplicated, order-preserving).
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

	const result = runBacktest(spec, candlesByTicker);
	saveRun({ result });
	return json(result);
};
