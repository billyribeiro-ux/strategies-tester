/** Parameter-optimization contract — shared between client and server. */

import type { StrategySpec } from './spec';
import type { MetricValue } from './result';

/** One indicator-instance numeric parameter to sweep over an explicit value list. */
export interface OptimizeParam {
	/** `IndicatorInstance.id` in the base spec. */
	indicatorId: string;
	/** Parameter name on that instance (e.g. 'period'). */
	param: string;
	/** Values to try. */
	values: number[];
}

export interface OptimizationSpec {
	base: StrategySpec;
	params: OptimizeParam[];
	/** Metric id to rank by (default 'totalReturn'). Direction follows the
	 *  metric's own `betterWhenHigher`. */
	sortMetric?: string;
}

export interface OptimizationOverride {
	indicatorId: string;
	param: string;
	value: number;
}

export interface OptimizationCombo {
	id: string;
	overrides: OptimizationOverride[];
	/** Headline metrics, NaN-free, for the table. */
	totalReturn: number;
	sharpe: number;
	maxDrawdown: number;
	winRate: number;
	totalTrades: number;
	/** Full metric set (for the sort key and detail). */
	metrics: MetricValue[];
}

export interface OptimizationResult {
	/** Ranked best-first by `sortMetric`. */
	combos: OptimizationCombo[];
	best: OptimizationCombo | null;
	/** Total combinations enumerated from the param grid. */
	totalCombos: number;
	/** How many were actually run (after the safety cap). */
	ran: number;
	capped: boolean;
	sortMetric: string;
	warnings: string[];
}
