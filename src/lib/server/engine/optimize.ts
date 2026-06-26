/**
 * Parameter optimization — PURE (reuses the pure backtest engine).
 *
 * Given a base spec and a grid of indicator-parameter values, enumerate the
 * combinations, run the backtest for each (candles are fetched once by the
 * caller and shared), and return them ranked by a chosen metric. No network/DB.
 */

import type {
	Candle,
	OptimizationCombo,
	OptimizationOverride,
	OptimizationResult,
	OptimizationSpec,
	OptimizeParam,
	StrategySpec
} from '$lib/types';
import { runBacktest } from './engine';

/** Safety cap on how many backtests a single optimization runs. */
export const MAX_OPTIMIZATION_COMBOS = 200;

/** Cartesian product of the param value lists → list of override sets. */
export function enumerateCombos(params: OptimizeParam[]): OptimizationOverride[][] {
	const usable = params.filter((p) => p.values.length > 0);
	let combos: OptimizationOverride[][] = [[]];
	for (const p of usable) {
		const next: OptimizationOverride[][] = [];
		for (const combo of combos) {
			for (const value of p.values) {
				next.push([...combo, { indicatorId: p.indicatorId, param: p.param, value }]);
			}
		}
		combos = next;
	}
	return combos;
}

/** Apply param overrides to a deep clone of the base spec (base is never mutated). */
export function applyOverrides(
	base: StrategySpec,
	overrides: OptimizationOverride[]
): StrategySpec {
	const spec = structuredClone(base);
	for (const o of overrides) {
		const inst = spec.indicators.find((i) => i.id === o.indicatorId);
		if (inst) inst.params = { ...inst.params, [o.param]: o.value };
	}
	return spec;
}

/**
 * Rank combos best-first by the raw metric value (descending). The engine stores
 * "bad" metrics with signs that keep this correct — e.g. maxDrawdown is negative,
 * so the highest (least-negative) value is the best result.
 */
export function rankCombos(combos: OptimizationCombo[], sortMetric: string): OptimizationCombo[] {
	const val = (c: OptimizationCombo) => {
		const v = c.metrics.find((x) => x.id === sortMetric)?.value;
		return typeof v === 'number' && Number.isFinite(v) ? v : -Infinity;
	};
	return [...combos].sort((a, b) => val(b) - val(a));
}

function metric(combo: { metrics: { id: string; value: number }[] }, id: string): number {
	const v = combo.metrics.find((x) => x.id === id)?.value;
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function runOptimization(
	spec: OptimizationSpec,
	candlesByTicker: Record<string, Candle[]>,
	maxCombos: number = MAX_OPTIMIZATION_COMBOS
): OptimizationResult {
	const sortMetric = spec.sortMetric ?? 'totalReturn';
	const all = enumerateCombos(spec.params);
	const capped = all.length > maxCombos;
	const toRun = all.slice(0, maxCombos);
	const warnings: string[] = [];
	if (capped) {
		warnings.push(`Grid has ${all.length} combinations; ran the first ${maxCombos}.`);
	}

	const combos: OptimizationCombo[] = toRun.map((overrides, i) => {
		const result = runBacktest(applyOverrides(spec.base, overrides), candlesByTicker);
		const c = { metrics: result.metrics };
		return {
			id: `combo_${i}`,
			overrides,
			totalReturn: metric(c, 'totalReturn'),
			sharpe: metric(c, 'sharpe'),
			maxDrawdown: metric(c, 'maxDrawdown'),
			winRate: metric(c, 'winRate'),
			totalTrades: metric(c, 'totalTrades'),
			metrics: result.metrics
		};
	});

	const ranked = rankCombos(combos, sortMetric);
	return {
		combos: ranked,
		best: ranked[0] ?? null,
		totalCombos: all.length,
		ran: ranked.length,
		capped,
		sortMetric,
		warnings
	};
}
