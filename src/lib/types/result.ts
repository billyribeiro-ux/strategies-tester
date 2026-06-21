/**
 * BacktestResult contract — response of `POST /api/backtest`.
 *
 * The results UI DERIVES its metric set from `metrics[]` (data-driven cards),
 * so new metrics the backend reports appear automatically. All money is in the
 * spec's account currency; all ratios/percentages are fractions unless the
 * `MetricValue.format` says otherwise.
 */

import type { StrategySpec } from './spec';

export type MetricFormat = 'pct' | 'ratio' | 'currency' | 'int' | 'duration' | 'r';
export type MetricGroup = 'returns' | 'risk' | 'trade';

export interface MetricValue {
	id: string;
	label: string;
	value: number;
	format: MetricFormat;
	group: MetricGroup;
	/** Higher is better (true), lower is better (false), or neutral (undefined). */
	betterWhenHigher?: boolean;
	description?: string;
}

export interface EquityPoint {
	t: string; // ISO timestamp
	equity: number; // account value
}

export interface DrawdownPoint {
	t: string;
	drawdown: number; // <= 0, fraction of peak equity
}

export type TradeSide = 'long' | 'short';

export type ExitReason =
	| 'signal'
	| 'stopLoss'
	| 'takeProfit'
	| 'trailingStop'
	| 'endOfData';

export const EXIT_REASONS: readonly ExitReason[] = [
	'signal',
	'stopLoss',
	'takeProfit',
	'trailingStop',
	'endOfData'
] as const;

export interface Trade {
	id: string;
	ticker: string;
	side: TradeSide;
	entryTime: string;
	entryPrice: number;
	exitTime: string;
	exitPrice: number;
	qty: number;
	pnl: number; // realized P&L in currency, net of costs
	pnlPct: number; // fraction of entry notional
	rMultiple: number; // P&L in units of initial risk (NaN if no stop)
	mae: number; // maximum adverse excursion, fraction
	mfe: number; // maximum favorable excursion, fraction
	exitReason: ExitReason;
	barsHeld: number;
}

export interface MonthlyReturn {
	year: number;
	month: number; // 1-12
	returnPct: number; // fraction
}

export interface DistributionBin {
	lower: number; // fraction (trade return bucket lower bound)
	upper: number;
	count: number;
}

export interface Candle {
	t: string; // ISO timestamp
	o: number;
	h: number;
	l: number;
	c: number;
	v: number;
}

/** A trade entry/exit marker for overlaying on the price chart. */
export interface TradeMarker {
	tradeId: string;
	t: string;
	price: number;
	kind: 'entry' | 'exit';
	side: TradeSide;
}

export interface BacktestResult {
	runId: string;
	spec: StrategySpec;
	metrics: MetricValue[];
	equityCurve: EquityPoint[];
	drawdown: DrawdownPoint[];
	trades: Trade[];
	monthlyReturns: MonthlyReturn[];
	distribution: DistributionBin[];
	/** Per-ticker OHLC (from FMP) for the optional price chart. */
	candles?: Record<string, Candle[]>;
	warnings: string[];
	computedAt: string;
}

/** Lightweight summary persisted alongside a run for listings. */
export interface RunSummary {
	runId: string;
	strategyName: string;
	computedAt: string;
	totalReturn: number;
	sharpe: number;
	maxDrawdown: number;
	totalTrades: number;
}
