/**
 * Performance metrics, equity/drawdown curves, monthly returns and the trade
 * P&L distribution. All derived from the realized trades and the marked-to-
 * market equity curve the engine produces. Edge cases (no trades, no losing
 * trades) yield finite, sensible values — never `NaN` in the emitted output.
 */

import type {
	DistributionBin,
	DrawdownPoint,
	EquityPoint,
	MetricValue,
	MonthlyReturn,
	Trade
} from '$lib/types';

/** Number of bins for the trade-return histogram. */
const DISTRIBUTION_BINS = 21;

/** A safe ratio: 0 numerator → 0; 0 denominator with positive numerator → cap. */
function safeRatio(num: number, den: number, cap = 1e9): number {
	if (den === 0) return num === 0 ? 0 : cap;
	const r = num / den;
	return Number.isFinite(r) ? r : cap;
}

// ---------------------------------------------------------------------------
// Equity-derived curves
// ---------------------------------------------------------------------------

/** Running-peak drawdown as a fraction (≤ 0) at each equity point. */
export function computeDrawdown(equity: EquityPoint[]): DrawdownPoint[] {
	let peak = -Infinity;
	return equity.map((p) => {
		if (p.equity > peak) peak = p.equity;
		const dd = peak > 0 ? p.equity / peak - 1 : 0;
		return { t: p.t, drawdown: Math.min(0, dd) };
	});
}

/** Group equity into calendar months; return = end/prevMonthEnd - 1. */
export function computeMonthlyReturns(equity: EquityPoint[]): MonthlyReturn[] {
	if (equity.length === 0) return [];
	// Last equity value within each calendar month, in chronological order.
	const monthKeys: string[] = [];
	const lastByMonth = new Map<string, { year: number; month: number; equity: number }>();
	for (const p of equity) {
		const d = new Date(p.t);
		const year = d.getUTCFullYear();
		const month = d.getUTCMonth() + 1;
		const key = `${year}-${month}`;
		if (!lastByMonth.has(key)) monthKeys.push(key);
		lastByMonth.set(key, { year, month, equity: p.equity });
	}

	const out: MonthlyReturn[] = [];
	let prevEquity = equity[0].equity;
	for (const key of monthKeys) {
		const entry = lastByMonth.get(key)!;
		const ret = prevEquity > 0 ? entry.equity / prevEquity - 1 : 0;
		out.push({ year: entry.year, month: entry.month, returnPct: ret });
		prevEquity = entry.equity;
	}
	return out;
}

/** Histogram of per-trade pnlPct into ~21 equal-width bins across min..max. */
export function computeDistribution(trades: Trade[]): DistributionBin[] {
	if (trades.length === 0) return [];
	const values = trades.map((t) => t.pnlPct);
	let min = Math.min(...values);
	let max = Math.max(...values);
	if (min === max) {
		// All identical — produce a single centered bin so the chart has data.
		const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 0.01;
		min -= pad;
		max += pad;
	}
	const width = (max - min) / DISTRIBUTION_BINS;
	const bins: DistributionBin[] = [];
	for (let b = 0; b < DISTRIBUTION_BINS; b++) {
		bins.push({ lower: min + b * width, upper: min + (b + 1) * width, count: 0 });
	}
	for (const v of values) {
		let idx = Math.floor((v - min) / width);
		if (idx < 0) idx = 0;
		if (idx >= DISTRIBUTION_BINS) idx = DISTRIBUTION_BINS - 1;
		bins[idx].count++;
	}
	return bins;
}

// ---------------------------------------------------------------------------
// Scalar metrics
// ---------------------------------------------------------------------------

export interface MetricsInput {
	trades: Trade[];
	equity: EquityPoint[];
	initialCapital: number;
	/** Bars in the portfolio timeline (for CAGR/Sharpe annualization). */
	totalBars: number;
	/** Bars during which at least one position was open (for exposure). */
	barsInMarket: number;
	/** Seconds per bar from the timeframe (for annualization). */
	timeframeSeconds: number;
}

const SECONDS_PER_YEAR = 365 * 86_400;

/**
 * Build the full metric set. Sharpe/Sortino annualize per-bar equity returns by
 * `sqrt(periodsPerYear)` where `periodsPerYear = SECONDS_PER_YEAR /
 * timeframeSeconds` (calendar-time convention, explicit and timeframe-aware).
 */
export function computeMetrics(input: MetricsInput): MetricValue[] {
	const { trades, equity, initialCapital, totalBars, barsInMarket, timeframeSeconds } = input;

	const finalEquity = equity.length > 0 ? equity[equity.length - 1].equity : initialCapital;
	const totalReturn = initialCapital > 0 ? finalEquity / initialCapital - 1 : 0;

	// Per-bar simple returns of the equity curve.
	const barReturns: number[] = [];
	for (let i = 1; i < equity.length; i++) {
		const prev = equity[i - 1].equity;
		barReturns.push(prev > 0 ? equity[i].equity / prev - 1 : 0);
	}

	const periodsPerYear = timeframeSeconds > 0 ? SECONDS_PER_YEAR / timeframeSeconds : 252;

	// CAGR from elapsed calendar time spanned by the equity curve.
	let cagr = 0;
	if (equity.length >= 2 && initialCapital > 0 && finalEquity > 0) {
		const startMs = Date.parse(equity[0].t);
		const endMs = Date.parse(equity[equity.length - 1].t);
		const years = (endMs - startMs) / (SECONDS_PER_YEAR * 1000);
		if (years > 0) cagr = Math.pow(finalEquity / initialCapital, 1 / years) - 1;
		else cagr = totalReturn;
	}

	const meanReturn = mean(barReturns);
	const stdReturn = stdDev(barReturns, meanReturn);
	const downsideDev = downsideDeviation(barReturns);
	const annFactor = Math.sqrt(periodsPerYear);
	const sharpe = stdReturn > 0 ? safeRatio(meanReturn, stdReturn) * annFactor : 0;
	const sortino =
		downsideDev > 0
			? safeRatio(meanReturn, downsideDev) * annFactor
			: meanReturn > 0
				? 1e9
				: 0;

	const drawdown = computeDrawdown(equity);
	const maxDrawdown = drawdown.reduce((min, p) => Math.min(min, p.drawdown), 0);

	// Trade statistics.
	const wins = trades.filter((t) => t.pnl > 0);
	const losses = trades.filter((t) => t.pnl < 0);
	const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
	const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
	const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
	const winRate = trades.length > 0 ? wins.length / trades.length : 0;
	const profitFactor = safeRatio(grossWin, grossLoss);
	const expectancy = trades.length > 0 ? totalPnl / trades.length : 0;
	const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
	const avgLoss = losses.length > 0 ? -grossLoss / losses.length : 0;
	const rTrades = trades.filter((t) => Number.isFinite(t.rMultiple));
	const avgR = rTrades.length > 0 ? rTrades.reduce((s, t) => s + t.rMultiple, 0) / rTrades.length : 0;
	const exposure = totalBars > 0 ? barsInMarket / totalBars : 0;
	const avgHold =
		trades.length > 0 ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0;

	const metrics: MetricValue[] = [
		m('totalReturn', 'Total return', totalReturn, 'pct', 'returns', true),
		m('cagr', 'CAGR', cagr, 'pct', 'returns', true),
		m('sharpe', 'Sharpe ratio', sharpe, 'ratio', 'risk', true),
		m('sortino', 'Sortino ratio', sortino, 'ratio', 'risk', true),
		m('maxDrawdown', 'Max drawdown', maxDrawdown, 'pct', 'risk', false),
		m('winRate', 'Win rate', winRate, 'pct', 'trade', true),
		m('profitFactor', 'Profit factor', profitFactor, 'ratio', 'trade', true),
		m('expectancy', 'Expectancy', expectancy, 'currency', 'trade', true),
		m('avgWin', 'Average win', avgWin, 'currency', 'trade', true),
		m('avgLoss', 'Average loss', avgLoss, 'currency', 'trade', false),
		m('avgR', 'Average R', avgR, 'r', 'trade', true),
		m('totalTrades', 'Total trades', trades.length, 'int', 'trade'),
		m('exposure', 'Exposure', exposure, 'pct', 'risk'),
		m('avgHold', 'Average hold', avgHold, 'duration', 'trade')
	];

	// Final guard: never emit a NaN/Infinity-as-NaN value.
	return metrics.map((mv) => ({ ...mv, value: sanitize(mv.value) }));
}

function m(
	id: string,
	label: string,
	value: number,
	format: MetricValue['format'],
	group: MetricValue['group'],
	betterWhenHigher?: boolean
): MetricValue {
	return { id, label, value, format, group, betterWhenHigher };
}

function sanitize(v: number): number {
	if (Number.isNaN(v)) return 0;
	return v;
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[], mu: number): number {
	if (values.length < 2) return 0;
	const variance = values.reduce((s, v) => s + (v - mu) * (v - mu), 0) / (values.length - 1);
	return Math.sqrt(variance);
}

/** Downside deviation relative to a 0% target (sample-based). */
function downsideDeviation(values: number[]): number {
	if (values.length < 2) return 0;
	const negatives = values.map((v) => (v < 0 ? v * v : 0));
	const variance = negatives.reduce((s, v) => s + v, 0) / (values.length - 1);
	return Math.sqrt(variance);
}
