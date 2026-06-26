/** Walk-forward analysis contract — shared between client and server. */

import type { OptimizationOverride, OptimizeParam } from './optimize';
import type { MetricValue, StrategySpec } from './index';

export interface WalkForwardSpec {
	base: StrategySpec;
	params: OptimizeParam[];
	/** Metric to optimize on each in-sample window (default 'totalReturn'). */
	sortMetric?: string;
	/** Number of out-of-sample windows (anchored: in-sample grows each window). */
	windows: number;
}

/** A single in-sample → out-of-sample window. */
export interface WalkForwardWindow {
	index: number;
	isFrom: string;
	isTo: string;
	oosFrom: string;
	oosTo: string;
	/** Best params found on the in-sample window. */
	bestOverrides: OptimizationOverride[];
	/** The sort-metric value achieved in-sample (the optimization picked this). */
	isMetric: number;
	/** Out-of-sample performance of those params (the honest result). */
	oosTotalReturn: number;
	oosSharpe: number;
	oosMaxDrawdown: number;
	oosWinRate: number;
	oosTrades: number;
	/** The sort-metric value achieved out-of-sample. */
	oosMetric: number;
	oosMetrics: MetricValue[];
}

export interface WalkForwardResult {
	windows: WalkForwardWindow[];
	sortMetric: string;
	/** Compounded out-of-sample return across all windows. */
	combinedOosReturn: number;
	/** mean(out-of-sample metric) / mean(in-sample metric); ~1+ suggests robustness. */
	efficiency: number;
	warnings: string[];
}
