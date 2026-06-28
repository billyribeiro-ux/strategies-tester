/**
 * Advanced optimization SEARCH strategies over the strategy parameter grid —
 * PURE and DETERMINISTIC (reuses the pure backtest engine and the same
 * combo-building/ranking primitives as the exhaustive optimizer).
 *
 * Two searchers are exported:
 *
 *  - `randomSearch` — samples WITHOUT replacement from the full enumerated grid
 *    (seeded shuffle, then take N) and ranks by a chosen objective.
 *  - `geneticSearch` — a small genetic algorithm over genomes (one value per
 *    swept param), with seeded init, tournament selection, uniform crossover and
 *    per-gene resampling mutation; memoizes by genome key to avoid re-running
 *    identical backtests.
 *
 * Both reuse `enumerateCombos`/`applyOverrides` from `./optimize` and build the
 * exact `OptimizationCombo` shape it produces. Randomness comes ONLY from
 * `makeRng(seed)` (mulberry32) — never `Math.random()` — so the same seed plus
 * the same inputs yields a byte-for-byte identical `OptimizationResult`.
 */

import type {
	BacktestResult,
	Candle,
	OptimizationCombo,
	OptimizationOverride,
	OptimizationResult,
	OptimizationSpec,
	OptimizeParam
} from '$lib/types';
import { runBacktest } from './engine';
import { applyOverrides, enumerateCombos, MAX_OPTIMIZATION_COMBOS } from './optimize';
import { makeRng, shuffle, type Rng } from '../validation/rng';

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

/** Scores a finished backtest; HIGHER is better. */
export type Objective = (result: BacktestResult) => number;

/** Read a metric value, treating missing/non-finite as 0 (mirrors optimize.ts). */
function metricValue(result: BacktestResult, id: string): number {
	const v = result.metrics.find((m) => m.id === id)?.value;
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Built-in, robust objectives (all read `result.metrics`, all finite):
 *
 *  - `totalReturn` — raw fractional total return.
 *  - `sharpe` — annualized Sharpe ratio.
 *  - `oosDeflatedProxy` — a single-run stand-in for an OOS-deflated Sharpe.
 *    Formula: `sharpe / (1 + 5 * |maxDrawdown|)`. `maxDrawdown` is stored as a
 *    negative fraction (e.g. -0.20 for a 20% drawdown), so a deeper drawdown
 *    shrinks the score: a Sharpe of 2.0 with no drawdown stays 2.0, but with a
 *    20% drawdown it deflates to 2.0 / (1 + 1.0) = 1.0. This penalizes
 *    curve-fit configs that buy a high Sharpe with deep equity dips, standing in
 *    for the out-of-sample haircut a deflated Sharpe would apply. Always finite
 *    (denominator >= 1).
 */
export const objectives: Record<string, Objective> = {
	totalReturn: (r) => metricValue(r, 'totalReturn'),
	sharpe: (r) => metricValue(r, 'sharpe'),
	oosDeflatedProxy: (r) => {
		const sharpe = metricValue(r, 'sharpe');
		const dd = Math.abs(metricValue(r, 'maxDrawdown'));
		return sharpe / (1 + 5 * dd);
	}
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The list of swept params with at least one value (matches enumerateCombos). */
function usableParams(spec: OptimizationSpec): OptimizeParam[] {
	return spec.params.filter((p) => p.values.length > 0);
}

/** Build the headline `OptimizationCombo` shape exactly like optimize.ts does. */
function buildCombo(
	id: string,
	overrides: OptimizationOverride[],
	result: BacktestResult
): OptimizationCombo {
	return {
		id,
		overrides,
		totalReturn: metricValue(result, 'totalReturn'),
		sharpe: metricValue(result, 'sharpe'),
		maxDrawdown: metricValue(result, 'maxDrawdown'),
		winRate: metricValue(result, 'winRate'),
		totalTrades: metricValue(result, 'totalTrades'),
		metrics: result.metrics
	};
}

/**
 * Stable rank by objective, descending. Ties broken by combo id so the order is
 * fully deterministic regardless of the input order or sort stability.
 */
function rankByObjective(
	combos: OptimizationCombo[],
	scores: Map<string, number>
): OptimizationCombo[] {
	const score = (c: OptimizationCombo) => {
		const s = scores.get(c.id);
		return typeof s === 'number' && Number.isFinite(s) ? s : -Infinity;
	};
	return [...combos].sort((a, b) => {
		const d = score(b) - score(a);
		if (d !== 0) return d;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}

/** A canonical key for a genome / override set (order follows usableParams). */
function genomeKey(genome: OptimizationOverride[]): string {
	return genome.map((g) => `${g.indicatorId}:${g.param}=${g.value}`).join('|');
}

// ---------------------------------------------------------------------------
// Random search
// ---------------------------------------------------------------------------

/**
 * Sample `iterations` distinct combos WITHOUT replacement from the full grid
 * (seeded shuffle then take N), run each backtest, and rank by `objective`.
 *
 * `ran === min(iterations, gridSize)` (further bounded by `maxCombos`). The
 * result is `OptimizationResult`-shaped; `sortMetric` is a descriptive label of
 * the objective used for ranking, not a raw metric id.
 */
export function randomSearch(
	spec: OptimizationSpec,
	candlesByTicker: Record<string, Candle[]>,
	opts: { iterations: number; seed: number; objective?: Objective; maxCombos?: number }
): OptimizationResult {
	const objective = opts.objective ?? objectives.totalReturn;
	const maxCombos = opts.maxCombos ?? MAX_OPTIMIZATION_COMBOS;
	const sortMetric = 'objective:randomSearch';
	const warnings: string[] = [];

	const all = enumerateCombos(spec.params);
	const totalCombos = all.length;

	// Cap the sample at the grid size, the requested iterations and the safety cap.
	const requested = Math.max(0, Math.floor(opts.iterations));
	const cap = Math.min(totalCombos, maxCombos);
	const sampleSize = Math.min(requested, cap);

	const capped = requested > cap && totalCombos > 0;
	if (capped) {
		warnings.push(
			`Requested ${requested} iterations but the grid (after the ${maxCombos}-combo safety cap) ` +
				`allows at most ${cap}; ran ${sampleSize}.`
		);
	}

	const rng = makeRng(opts.seed);
	const sampled = shuffle(all, rng).slice(0, sampleSize);

	const scores = new Map<string, number>();
	const combos: OptimizationCombo[] = sampled.map((overrides, i) => {
		const id = `rs_${i}`;
		const result = runBacktest(applyOverrides(spec.base, overrides), candlesByTicker);
		const combo = buildCombo(id, overrides, result);
		scores.set(id, objective(result));
		return combo;
	});

	const ranked = rankByObjective(combos, scores);
	warnings.push(`randomSearch evaluated ${combos.length} of ${totalCombos} combinations.`);

	return {
		combos: ranked,
		best: ranked[0] ?? null,
		totalCombos,
		ran: ranked.length,
		capped,
		sortMetric,
		warnings
	};
}

// ---------------------------------------------------------------------------
// Genetic search
// ---------------------------------------------------------------------------

/**
 * A small, fully-deterministic genetic algorithm over the parameter grid.
 *
 * Genome = one `OptimizationOverride[]` (one chosen value per swept param, in
 * `usableParams` order). Operators, all driven by the seeded rng:
 *  - init: each gene sampled uniformly from its param's value list.
 *  - selection: binary tournament (best of two random members).
 *  - crossover: uniform (each gene taken from either parent with p=0.5).
 *  - mutation: per-gene, with probability `mutationRate`, resample that gene's
 *    value from its param's value list.
 *
 * Backtests are memoized by genome key, so re-encountered genomes cost nothing.
 * Returns a best-first `OptimizationResult`; `warnings` notes evaluations done.
 */
export function geneticSearch(
	spec: OptimizationSpec,
	candlesByTicker: Record<string, Candle[]>,
	opts: {
		populationSize: number;
		generations: number;
		seed: number;
		objective?: Objective;
		mutationRate?: number;
	}
): OptimizationResult {
	const objective = opts.objective ?? objectives.totalReturn;
	const mutationRate = opts.mutationRate ?? 0.1;
	const sortMetric = 'objective:geneticSearch';
	const warnings: string[] = [];

	const params = usableParams(spec);
	const totalCombos = enumerateCombos(spec.params).length;
	const rng = makeRng(opts.seed);

	// Memo: genome key -> { combo, score }. Also collects every distinct combo
	// evaluated, so the final result ranks across the whole search history.
	const memo = new Map<string, { combo: OptimizationCombo; score: number }>();
	let comboSeq = 0;

	const evaluate = (genome: OptimizationOverride[]): number => {
		const key = genomeKey(genome);
		const hit = memo.get(key);
		if (hit) return hit.score;
		const result = runBacktest(applyOverrides(spec.base, genome), candlesByTicker);
		const combo = buildCombo(`gs_${comboSeq++}`, genome, result);
		const score = objective(result);
		memo.set(key, { combo, score });
		return score;
	};

	// Degenerate grids (no params, or every param has a single value): there is at
	// most one genome. Evaluate it (if any) and return immediately.
	const emptyGrid = params.length === 0 || totalCombos === 0;
	const popSize = Math.max(1, Math.floor(opts.populationSize));
	const generations = Math.max(0, Math.floor(opts.generations));

	const randomGenome = (): OptimizationOverride[] =>
		params.map((p) => ({
			indicatorId: p.indicatorId,
			param: p.param,
			value: p.values[rng.int(p.values.length)]
		}));

	if (emptyGrid) {
		// A single empty-override genome (mirrors enumerateCombos([]) === [[]]).
		evaluate([]);
	} else {
		let population: OptimizationOverride[][] = Array.from({ length: popSize }, randomGenome);
		for (const g of population) evaluate(g);

		for (let gen = 0; gen < generations; gen++) {
			population = nextGeneration(population);
			for (const g of population) evaluate(g);
		}
	}

	const combos = [...memo.values()].map((m) => m.combo);
	const scores = new Map(combos.map((c) => [c.id, memo.get(genomeKey(c.overrides))!.score]));
	const ranked = rankByObjective(combos, scores);

	warnings.push(
		`geneticSearch evaluated ${memo.size} distinct genomes ` +
			`(population ${popSize}, ${generations} generations) of ${totalCombos} possible.`
	);

	return {
		combos: ranked,
		best: ranked[0] ?? null,
		totalCombos,
		ran: ranked.length,
		capped: false,
		sortMetric,
		warnings
	};

	// --- closures over rng / evaluate / params ---

	/** Binary tournament: pick two random members, keep the higher-scoring one. */
	function tournament(population: OptimizationOverride[][]): OptimizationOverride[] {
		const a = population[rng.int(population.length)];
		const b = population[rng.int(population.length)];
		return evaluate(a) >= evaluate(b) ? a : b;
	}

	/** Uniform crossover: each gene comes from parent A or B with p = 0.5. */
	function crossover(a: OptimizationOverride[], b: OptimizationOverride[]): OptimizationOverride[] {
		return params.map((_, i) => (rng.next() < 0.5 ? a[i] : b[i]));
	}

	/** Per-gene mutation: resample a gene's value from its param's value list. */
	function mutate(genome: OptimizationOverride[]): OptimizationOverride[] {
		return genome.map((gene, i) => {
			if (rng.next() >= mutationRate) return gene;
			const p = params[i];
			return {
				indicatorId: p.indicatorId,
				param: p.param,
				value: p.values[rng.int(p.values.length)]
			};
		});
	}

	/** Build the next generation: elitism (best) + bred offspring. */
	function nextGeneration(population: OptimizationOverride[][]): OptimizationOverride[][] {
		const best = bestOf(population, evaluate);
		const next: OptimizationOverride[][] = [best];
		while (next.length < population.length) {
			const parentA = tournament(population);
			const parentB = tournament(population);
			next.push(mutate(crossover(parentA, parentB)));
		}
		return next;
	}
}

/** The single highest-scoring genome in a population (ties: earliest index). */
function bestOf(
	population: OptimizationOverride[][],
	score: (g: OptimizationOverride[]) => number
): OptimizationOverride[] {
	let best = population[0];
	let bestScore = score(best);
	for (let i = 1; i < population.length; i++) {
		const s = score(population[i]);
		if (s > bestScore) {
			best = population[i];
			bestScore = s;
		}
	}
	return best;
}

// Re-export the rng type alias so callers/tests don't reach into validation.
export type { Rng };
