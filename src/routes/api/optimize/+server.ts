/**
 * POST /api/optimize — parameter sweep.
 *
 * Validates the base spec (same as /api/backtest), validates the param grid,
 * fetches candles once for the shared universe, then searches the grid and
 * returns the results ranked by the chosen metric/objective.
 *
 * Optional `mode` selects the search strategy (default 'grid', back-compatible):
 *   'grid'     — exhaustive sweep via runOptimization (unchanged behavior).
 *   'random'   — seeded random sampling via randomSearch.
 *   'genetic'  — seeded genetic algorithm via geneticSearch.
 *   'bayesian' — seeded TPE (SMBO) sampler via bayesianSearch.
 * All return an `OptimizationResult`, so the response shape is unchanged.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Candle, OptimizationResult, OptimizationSpec, OptimizeParam } from '$lib/types';
import { parseSpec, validateSpec, hasErrors } from '$lib/validation';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import { fetchCandles } from '$lib/server/fmp/client';
import { runOptimization } from '$lib/server/engine/optimize';
import {
	randomSearch,
	geneticSearch,
	bayesianSearch,
	objectives,
	type Objective
} from '$lib/server/engine/search';

type SearchMode = 'grid' | 'random' | 'genetic' | 'bayesian';

/** Sensible search defaults; overridable via `searchOptions` in the request body. */
const SEARCH_DEFAULTS = {
	iterations: 50,
	populationSize: 20,
	generations: 10,
	initRandom: 10,
	seed: 1
} as const;

/** Read a finite positive integer from an unknown options bag, else a fallback. */
function intOpt(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: fallback;
}

/** Resolve a named objective to its function; default totalReturn for unknown/missing. */
function resolveObjective(name: unknown): Objective {
	return typeof name === 'string' && name in objectives ? objectives[name] : objectives.totalReturn;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}
	if (!body || typeof body !== 'object') {
		throw error(400, { message: 'Expected { base, params, sortMetric? }.' });
	}
	const { base, params, sortMetric, mode, searchOptions } = body as {
		base?: unknown;
		params?: unknown;
		sortMetric?: unknown;
		mode?: unknown;
		searchOptions?: unknown;
	};

	// Validate the base spec structurally + semantically.
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

	// Validate the param grid.
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
			throw error(400, {
				message: 'Each param needs { indicatorId, param, values: number[] }.'
			});
		}
		if (!spec.indicators.some((i) => i.id === indicatorId)) {
			throw error(400, { message: `Unknown indicator instance "${indicatorId}".` });
		}
		cleanParams.push({ indicatorId, param, values: values as number[] });
	}

	// Fetch candles once for the shared universe (same as /api/backtest).
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

	const optSpec: OptimizationSpec = {
		base: spec,
		params: cleanParams,
		sortMetric: typeof sortMetric === 'string' ? sortMetric : undefined
	};

	const searchMode: SearchMode =
		mode === 'random' || mode === 'genetic' || mode === 'bayesian' || mode === 'grid'
			? mode
			: 'grid';
	const opts =
		searchOptions && typeof searchOptions === 'object'
			? (searchOptions as Record<string, unknown>)
			: {};
	const seed = intOpt(opts.seed, SEARCH_DEFAULTS.seed);
	const objective = resolveObjective(opts.objective);

	let result: OptimizationResult;
	if (searchMode === 'random') {
		result = randomSearch(optSpec, candlesByTicker, {
			iterations: intOpt(opts.iterations, SEARCH_DEFAULTS.iterations),
			seed,
			objective
		});
	} else if (searchMode === 'genetic') {
		result = geneticSearch(optSpec, candlesByTicker, {
			populationSize: intOpt(opts.populationSize, SEARCH_DEFAULTS.populationSize),
			generations: intOpt(opts.generations, SEARCH_DEFAULTS.generations),
			seed,
			objective
		});
	} else if (searchMode === 'bayesian') {
		result = bayesianSearch(optSpec, candlesByTicker, {
			iterations: intOpt(opts.iterations, SEARCH_DEFAULTS.iterations),
			initRandom: intOpt(opts.initRandom, SEARCH_DEFAULTS.initRandom),
			seed,
			objective
		});
	} else {
		result = runOptimization(optSpec, candlesByTicker);
	}
	return json(result);
};
