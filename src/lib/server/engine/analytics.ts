/**
 * Extended performance analytics (spec §7): tail-risk, drawdown-shape,
 * streak, regression and attribution measures derived from the realized trades
 * and the marked-to-market equity/drawdown curves. All functions are pure and
 * deterministic. Empty inputs yield finite, sensible values — never `NaN`.
 */

import type { DrawdownPoint, EquityPoint, ExitReason, Trade, TradeSide } from '$lib/types';
import { mean, percentile } from '../validation/stats';

/** Per-dimension attribution row. */
export interface AttributionRow {
	count: number;
	netPnl: number;
	wins: number;
	winRate: number;
}

/** Trade attribution grouped by symbol, side and exit reason. */
export interface Attribution {
	bySymbol: Record<string, AttributionRow>;
	bySide: Record<string, AttributionRow>;
	byExitReason: Record<string, AttributionRow>;
}

/** Per-calendar-year return of the equity curve. */
export interface YearRegime {
	year: number;
	returnPct: number;
}

/** Time-spent-underwater summary. */
export interface UnderwaterStats {
	longestBars: number;
	fraction: number;
}

/** Market-relative regression coefficients. */
export interface AlphaBeta {
	alpha: number;
	beta: number;
}

/** The full §7 analytics bundle. */
export interface Analytics {
	cvar: number;
	ulcerIndex: number;
	timeUnderwater: UnderwaterStats;
	longestLosingStreak: number;
	calmar: number;
	omega: number;
	alphaBeta: AlphaBeta;
	attribution: Attribution;
	regimeByYear: YearRegime[];
}

// ---------------------------------------------------------------------------
// Tail risk
// ---------------------------------------------------------------------------

/** Conditional VaR: mean of the worst `alpha`-tail of returns (≤ 0 for losses). */
export function cvar(returns: number[], alpha = 0.05): number {
	if (returns.length === 0) return 0;
	const sorted = [...returns].sort((a, b) => a - b);
	const cutoff = percentile(sorted, alpha);
	const tail = sorted.filter((r) => r <= cutoff);
	if (tail.length === 0) return sorted[0];
	const avg = mean(tail);
	return Number.isFinite(avg) ? avg : 0;
}

// ---------------------------------------------------------------------------
// Drawdown shape
// ---------------------------------------------------------------------------

/** Ulcer index: sqrt(mean(drawdownPct²)) where drawdownPct is % below running peak. */
export function ulcerIndex(equity: EquityPoint[]): number {
	if (equity.length === 0) return 0;
	let peak = -Infinity;
	let sumSq = 0;
	for (const p of equity) {
		if (p.equity > peak) peak = p.equity;
		const ddPct = peak > 0 ? (p.equity / peak - 1) * 100 : 0;
		sumSq += ddPct * ddPct;
	}
	return Math.sqrt(sumSq / equity.length);
}

/** Longest consecutive underwater run (drawdown < 0) and fraction of bars underwater. */
export function timeUnderwater(drawdown: DrawdownPoint[]): UnderwaterStats {
	if (drawdown.length === 0) return { longestBars: 0, fraction: 0 };
	let longest = 0;
	let current = 0;
	let underwater = 0;
	for (const p of drawdown) {
		if (p.drawdown < 0) {
			current++;
			underwater++;
			if (current > longest) longest = current;
		} else {
			current = 0;
		}
	}
	return { longestBars: longest, fraction: underwater / drawdown.length };
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

/** Max consecutive losing trades (pnl < 0), chronological by entryTime. */
export function longestLosingStreak(trades: Trade[]): number {
	if (trades.length === 0) return 0;
	const ordered = [...trades].sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
	let longest = 0;
	let current = 0;
	for (const t of ordered) {
		if (t.pnl < 0) {
			current++;
			if (current > longest) longest = current;
		} else {
			current = 0;
		}
	}
	return longest;
}

// ---------------------------------------------------------------------------
// Ratios
// ---------------------------------------------------------------------------

/** Calmar ratio: cagr / |maxDrawdown|; 0 when maxDrawdown is 0. */
export function calmar(cagr: number, maxDrawdown: number): number {
	if (maxDrawdown === 0) return 0;
	const r = cagr / Math.abs(maxDrawdown);
	return Number.isFinite(r) ? r : 0;
}

/** Omega ratio: sum(gains above threshold) / |sum(losses below threshold)|. */
export function omega(returns: number[], threshold = 0): number {
	if (returns.length === 0) return 0;
	let gains = 0;
	let losses = 0;
	for (const r of returns) {
		const d = r - threshold;
		if (d > 0) gains += d;
		else if (d < 0) losses += -d;
	}
	if (losses === 0) return gains === 0 ? 0 : Infinity;
	return gains / losses;
}

// ---------------------------------------------------------------------------
// Market-relative regression
// ---------------------------------------------------------------------------

/** OLS of strategy on benchmark: beta = cov/var, alpha = meanStrat − beta·meanBench. */
export function alphaBeta(strategyReturns: number[], benchmarkReturns: number[]): AlphaBeta {
	const n = Math.min(strategyReturns.length, benchmarkReturns.length);
	if (n === 0) return { alpha: 0, beta: 0 };
	const strat = strategyReturns.slice(0, n);
	const bench = benchmarkReturns.slice(0, n);
	const meanStrat = mean(strat);
	const meanBench = mean(bench);
	let cov = 0;
	let varBench = 0;
	for (let i = 0; i < n; i++) {
		const db = bench[i] - meanBench;
		cov += (strat[i] - meanStrat) * db;
		varBench += db * db;
	}
	const beta = varBench > 0 ? cov / varBench : 0;
	const alpha = meanStrat - beta * meanBench;
	return {
		alpha: Number.isFinite(alpha) ? alpha : 0,
		beta: Number.isFinite(beta) ? beta : 0
	};
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/** Accumulate a trade into an attribution map keyed by `key`. */
function accumulate(map: Record<string, AttributionRow>, key: string, trade: Trade): void {
	const row = map[key] ?? { count: 0, netPnl: 0, wins: 0, winRate: 0 };
	row.count++;
	row.netPnl += trade.pnl;
	if (trade.pnl > 0) row.wins++;
	row.winRate = row.count > 0 ? row.wins / row.count : 0;
	map[key] = row;
}

/** Group trades by symbol, side and exit reason into count/netPnl/wins/winRate rows. */
export function attribution(trades: Trade[]): Attribution {
	const bySymbol: Record<string, AttributionRow> = {};
	const bySide: Record<TradeSide, AttributionRow> = {} as Record<TradeSide, AttributionRow>;
	const byExitReason: Record<ExitReason, AttributionRow> = {} as Record<ExitReason, AttributionRow>;
	for (const t of trades) {
		accumulate(bySymbol, t.ticker, t);
		accumulate(bySide, t.side, t);
		accumulate(byExitReason, t.exitReason, t);
	}
	return { bySymbol, bySide, byExitReason };
}

// ---------------------------------------------------------------------------
// Regime
// ---------------------------------------------------------------------------

/** Per-calendar-year equity return (first vs last equity within each year). */
export function regimeByYear(equity: EquityPoint[]): YearRegime[] {
	if (equity.length === 0) return [];
	const years: number[] = [];
	const firstByYear = new Map<number, number>();
	const lastByYear = new Map<number, number>();
	for (const p of equity) {
		const year = new Date(p.t).getUTCFullYear();
		if (!firstByYear.has(year)) {
			firstByYear.set(year, p.equity);
			years.push(year);
		}
		lastByYear.set(year, p.equity);
	}
	return years.map((year) => {
		const first = firstByYear.get(year)!;
		const last = lastByYear.get(year)!;
		const returnPct = first > 0 ? last / first - 1 : 0;
		return { year, returnPct };
	});
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Assemble the full §7 analytics bundle from engine outputs. */
export function computeAnalytics(args: {
	trades: Trade[];
	equity: EquityPoint[];
	drawdown: DrawdownPoint[];
	tradeReturns: number[];
	cagr: number;
	maxDrawdown: number;
	benchmarkReturns?: number[];
}): Analytics {
	return {
		cvar: cvar(args.tradeReturns),
		ulcerIndex: ulcerIndex(args.equity),
		timeUnderwater: timeUnderwater(args.drawdown),
		longestLosingStreak: longestLosingStreak(args.trades),
		calmar: calmar(args.cagr, args.maxDrawdown),
		omega: omega(args.tradeReturns),
		alphaBeta: alphaBeta(args.tradeReturns, args.benchmarkReturns ?? []),
		attribution: attribution(args.trades),
		regimeByYear: regimeByYear(args.equity)
	};
}
