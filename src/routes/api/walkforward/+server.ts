/**
 * POST /api/walkforward — walk-forward analysis.
 *
 * Same inputs as /api/optimize plus `windows`. Fetches candles once for the full
 * universe range, then optimizes on each in-sample window and tests the winners
 * out-of-sample.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Candle, OptimizeParam, WalkForwardSpec } from '$lib/types';
import { parseSpec, validateSpec, hasErrors } from '$lib/validation';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import { fetchCandles } from '$lib/server/fmp/client';
import { runWalkForward } from '$lib/server/engine/walkforward';

const MAX_WINDOWS = 12;

export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}
	if (!body || typeof body !== 'object') {
		throw error(400, { message: 'Expected { base, params, windows, sortMetric? }.' });
	}
	const { base, params, windows, sortMetric } = body as {
		base?: unknown;
		params?: unknown;
		windows?: unknown;
		sortMetric?: unknown;
	};

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

	const n = typeof windows === 'number' && Number.isFinite(windows) ? Math.floor(windows) : 0;
	if (n < 2 || n > MAX_WINDOWS) {
		throw error(400, { message: `"windows" must be between 2 and ${MAX_WINDOWS}.` });
	}

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

	const wfSpec: WalkForwardSpec = {
		base: spec,
		params: cleanParams,
		windows: n,
		sortMetric: typeof sortMetric === 'string' ? sortMetric : undefined
	};
	return json(runWalkForward(wfSpec, candlesByTicker));
};
