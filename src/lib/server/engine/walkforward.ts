/**
 * Walk-forward analysis — PURE (reuses the optimizer + backtest engine).
 *
 * Anchored scheme: the date range is divided into `windows + 1` equal parts. For
 * window k, the in-sample (IS) period is everything up to part k, and the
 * out-of-sample (OOS) period is the next part. On each IS window we optimize the
 * params, then test the winning params on the *unseen* OOS window — that OOS
 * performance is the honest, overfitting-resistant result.
 */

import type {
	Candle,
	MetricValue,
	StrategySpec,
	WalkForwardResult,
	WalkForwardSpec,
	WalkForwardWindow
} from '$lib/types';
import { runBacktest } from './engine';
import { applyOverrides, runOptimization } from './optimize';

export interface WalkForwardSplit {
	isFrom: string;
	isTo: string;
	oosFrom: string;
	oosTo: string;
}

const ms = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Divide [from, to] into `windows` anchored IS→OOS splits. */
export function splitWalkForward(from: string, to: string, windows: number): WalkForwardSplit[] {
	const start = ms(from);
	const end = ms(to);
	if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || windows < 1) return [];
	const parts = windows + 1;
	const step = (end - start) / parts;
	const splits: WalkForwardSplit[] = [];
	for (let k = 0; k < windows; k++) {
		const isTo = start + step * (k + 1);
		const oosTo = Math.min(start + step * (k + 2), end);
		splits.push({ isFrom: ymd(start), isTo: ymd(isTo), oosFrom: ymd(isTo), oosTo: ymd(oosTo) });
	}
	return splits;
}

/** Filter each ticker's candles to the inclusive [from, to] window. */
export function sliceCandles(
	candlesByTicker: Record<string, Candle[]>,
	from: string,
	to: string
): Record<string, Candle[]> {
	const lo = ms(from);
	const hi = ms(to);
	const out: Record<string, Candle[]> = {};
	for (const [ticker, candles] of Object.entries(candlesByTicker)) {
		out[ticker] = candles.filter((c) => {
			const t = Date.parse(c.t);
			return t >= lo && t <= hi;
		});
	}
	return out;
}

function withRange(base: StrategySpec, from: string, to: string): StrategySpec {
	const spec = structuredClone(base);
	spec.universe.dateRange = { from, to };
	return spec;
}

function metricValue(metrics: MetricValue[], id: string): number {
	const v = metrics.find((m) => m.id === id)?.value;
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function runWalkForward(
	spec: WalkForwardSpec,
	candlesByTicker: Record<string, Candle[]>
): WalkForwardResult {
	const sortMetric = spec.sortMetric ?? 'totalReturn';
	const { from, to } = spec.base.universe.dateRange;
	const splits = splitWalkForward(from, to, spec.windows);
	const warnings: string[] = [];

	const windows: WalkForwardWindow[] = [];
	splits.forEach((split, index) => {
		const isCandles = sliceCandles(candlesByTicker, split.isFrom, split.isTo);
		const oosCandles = sliceCandles(candlesByTicker, split.oosFrom, split.oosTo);
		const hasIs = Object.values(isCandles).some((c) => c.length > 0);
		const hasOos = Object.values(oosCandles).some((c) => c.length > 0);
		if (!hasIs || !hasOos) {
			warnings.push(`Window ${index + 1} skipped (not enough data in the split).`);
			return;
		}

		const opt = runOptimization(
			{ base: withRange(spec.base, split.isFrom, split.isTo), params: spec.params, sortMetric },
			isCandles
		);
		const best = opt.best;
		const bestOverrides = best?.overrides ?? [];
		const isMetric = best ? metricValue(best.metrics, sortMetric) : 0;

		const oosResult = runBacktest(
			applyOverrides(withRange(spec.base, split.oosFrom, split.oosTo), bestOverrides),
			oosCandles
		);
		const m = oosResult.metrics;

		windows.push({
			index: index + 1,
			isFrom: split.isFrom,
			isTo: split.isTo,
			oosFrom: split.oosFrom,
			oosTo: split.oosTo,
			bestOverrides,
			isMetric,
			oosTotalReturn: metricValue(m, 'totalReturn'),
			oosSharpe: metricValue(m, 'sharpe'),
			oosMaxDrawdown: metricValue(m, 'maxDrawdown'),
			oosWinRate: metricValue(m, 'winRate'),
			oosTrades: metricValue(m, 'totalTrades'),
			oosMetric: metricValue(m, sortMetric),
			oosMetrics: m
		});
	});

	// Compounded out-of-sample return (chain the per-window returns).
	const combinedOosReturn = windows.reduce((acc, w) => acc * (1 + w.oosTotalReturn), 1) - 1;

	// Walk-forward efficiency: mean OOS metric / mean IS metric.
	const meanIs = windows.length ? windows.reduce((s, w) => s + w.isMetric, 0) / windows.length : 0;
	const meanOos = windows.length
		? windows.reduce((s, w) => s + w.oosMetric, 0) / windows.length
		: 0;
	const efficiency = meanIs !== 0 ? meanOos / meanIs : 0;

	return { windows, sortMetric, combinedOosReturn, efficiency, warnings };
}
