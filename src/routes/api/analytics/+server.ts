/**
 * GET /api/analytics?runId=…  (or POST { runId })
 *
 * Loads a stored `BacktestResult` by runId and returns the extended §7
 * performance analytics (tail-risk, drawdown-shape, streaks, ratios, attribution
 * and per-year regime). All the math lives in the engine's pure `computeAnalytics`;
 * this route only adapts the persisted result into that function's input shape:
 *   - `tradeReturns`  ← per-trade `pnlPct`
 *   - `cagr` / `maxDrawdown` ← the corresponding `metrics[]` values
 *   - `benchmarkReturns` ← per-point simple returns of the benchmark equity curve
 * Mirrors the 400 / 404 / json style of the other API routes.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { BacktestResult, EquityPoint, MetricValue } from '$lib/types';
import { getRun } from '$lib/server/db/repository';
import { computeAnalytics } from '$lib/server/engine/analytics';

/** Read a metric value by id, defaulting to 0 when absent. */
function metric(metrics: MetricValue[], id: string): number {
	return metrics.find((m) => m.id === id)?.value ?? 0;
}

/** Per-point simple returns of an equity curve (length n-1). */
function equityReturns(equity: EquityPoint[]): number[] {
	const returns: number[] = [];
	for (let i = 1; i < equity.length; i++) {
		const prev = equity[i - 1].equity;
		returns.push(prev > 0 ? equity[i].equity / prev - 1 : 0);
	}
	return returns;
}

/** Adapt a persisted run into `computeAnalytics` inputs and return the bundle. */
function analyticsFor(result: BacktestResult) {
	return computeAnalytics({
		trades: result.trades,
		equity: result.equityCurve,
		drawdown: result.drawdown,
		tradeReturns: result.trades.map((t) => t.pnlPct),
		cagr: metric(result.metrics, 'cagr'),
		maxDrawdown: metric(result.metrics, 'maxDrawdown'),
		benchmarkReturns: result.benchmark ? equityReturns(result.benchmark.equity) : undefined
	});
}

/** Resolve a run by id or throw the appropriate HTTP error. */
function loadRun(runId: string | null | undefined): BacktestResult {
	const id = runId?.trim();
	if (!id) throw error(400, { message: 'runId is required.' });
	const result = getRun(id);
	if (!result) throw error(404, { message: `Run "${id}" was not found.` });
	return result;
}

export const GET: RequestHandler = ({ url }) => {
	const result = loadRun(url.searchParams.get('runId'));
	return json(analyticsFor(result));
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}
	const runId = body && typeof body === 'object' ? (body as { runId?: unknown }).runId : undefined;
	const result = loadRun(typeof runId === 'string' ? runId : null);
	return json(analyticsFor(result));
};
