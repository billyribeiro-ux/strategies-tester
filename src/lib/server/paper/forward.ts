/**
 * Forward / paper-trade bridge (spec §9) — PURE.
 *
 * The whole point: run the SAME engine on the latest data so there is NO logic
 * fork between a backtest and the "live" signal. `computeForwardState` does two
 * things from one set of candles:
 *
 *  1. Runs `runBacktest(spec, candles)` to get the realized history. From that
 *     history it derives which positions would STILL be open at the latest bar.
 *  2. Independently re-evaluates each rule group (longEntry / longExit /
 *     shortEntry / shortExit) at the LAST closed bar of each ticker — i.e. "what
 *     the strategy signals right now and would act on next bar". This reuses the
 *     engine's own precompute + `evaluateGroup` so the per-bar truth value is
 *     identical to what the engine saw during the run.
 *
 * Deriving "still open at the last bar" WITHOUT the synthetic end-of-data close
 * ------------------------------------------------------------------------------
 * The engine force-closes every open position at end-of-data, tagging that fill
 * with `exitReason === 'endOfData'`. That close is synthetic — it does not reflect
 * a rule or a stop, only the data running out. So a position that was genuinely
 * still open at the latest bar is exactly an `endOfData` trade. We reconstruct
 * the open book by reading those trades back (ticker / side / qty / entry), which
 * needs no re-simulation and stays perfectly in lock-step with the engine.
 *
 * Everything here is deterministic and side-effect free (no network, no DB, no
 * clock): identical (spec, candles) inputs yield identical output.
 */

import type { BacktestResult, Candle, StrategySpec, TradeSide } from '$lib/types';
import { getComputeFn } from '../indicators/registry';
import { ParamReader } from '../indicators/compute';
import { runBacktest } from '../engine/engine';
import { evaluateGroup, type EvalContext, type IndicatorSeriesMap } from '../engine/evaluate';

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/** A position the strategy would still be holding as of the latest closed bar. */
export interface ForwardOpenPosition {
	ticker: string;
	side: TradeSide;
	qty: number;
	entryPrice: number;
	entryTime: string;
}

/** The four rule-group truth values at a ticker's last closed bar. */
export interface ForwardSignals {
	/** Long-entry group is TRUE at the last bar → would open/add long next bar. */
	longEntry: boolean;
	/** Long-exit group is TRUE → would close an open long next bar. */
	longExit: boolean;
	/** Short-entry group is TRUE → would open/add short next bar. */
	shortEntry: boolean;
	/** Short-exit group is TRUE → would cover an open short next bar. */
	shortExit: boolean;
}

/** Per-ticker forward snapshot at the latest closed bar. */
export interface ForwardTicker {
	ticker: string;
	/** ISO timestamp of the last closed bar evaluated (null when no candles). */
	lastBarTime: string | null;
	/** Close of the last bar (null when no candles). */
	lastClose: number | null;
	/** Current rule-group signals at the last closed bar. */
	signals: ForwardSignals;
	/** Positions still open on this ticker at the latest bar. */
	openPositions: ForwardOpenPosition[];
}

export interface ForwardState {
	/** Latest closed-bar timestamp across all tickers (null when no data). */
	asOf: string | null;
	/** All still-open positions across the universe at the latest bar. */
	openPositions: ForwardOpenPosition[];
	/** Convenience: any long-entry signal active across the universe. */
	pendingLong: boolean;
	/** Convenience: any short-exit signal active across the universe. */
	pendingShortExit: boolean;
	/** Per-ticker breakdown (signals + open positions). */
	perTicker: ForwardTicker[];
	/** Non-fatal notes carried from the engine run (e.g. skipped tickers). */
	warnings: string[];
}

/** Drift summary for the live-vs-backtest monitor. */
export interface Divergence {
	/** live.trades.length − backtest.trades.length. */
	tradeCountDelta: number;
	/** Last equity (live) − last equity (backtest). */
	lastEquityDelta: number;
	/** True when both deltas are zero (no observable drift). */
	identical: boolean;
}

// ---------------------------------------------------------------------------
// Precompute (replicated minimally — the engine does not export it)
// ---------------------------------------------------------------------------

/**
 * Compute every referenced indicator instance for one ticker into aligned series.
 * Mirrors the engine's private `precomputeIndicators` EXACTLY (same registry +
 * ParamReader calls) so the EvalContext is bit-for-bit what the engine evaluates
 * against — preserving the no-logic-fork guarantee.
 */
function precomputeIndicators(
	spec: StrategySpec,
	candles: Candle[]
): Record<string, IndicatorSeriesMap> {
	const out: Record<string, IndicatorSeriesMap> = {};
	for (const inst of spec.indicators) {
		const fn = getComputeFn(inst.type);
		if (!fn) continue; // validated upstream; skip unknown defensively
		const result = fn(candles, new ParamReader(inst.params), inst.priceSource);
		out[inst.id] = Array.isArray(result) ? { value: result } : result;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Build the forward/paper state for a spec against the latest candles.
 *
 * @param spec            The strategy spec (same one a backtest would use).
 * @param candlesByTicker Ascending candles per ticker, ending at the latest bar.
 */
export function computeForwardState(
	spec: StrategySpec,
	candlesByTicker: Record<string, Candle[]>
): ForwardState {
	// 1. Realized history from the IDENTICAL engine. Open book is derived from it.
	const backtest = runBacktest(spec, candlesByTicker);
	const openByTicker = deriveOpenPositions(backtest);

	const perTicker: ForwardTicker[] = [];
	let asOfMs = -Infinity;
	let asOf: string | null = null;
	let pendingLong = false;
	let pendingShortExit = false;
	const allOpen: ForwardOpenPosition[] = [];

	// Deterministic ticker order: follow the spec's declared universe order.
	for (const ticker of spec.universe.tickers) {
		const candles = candlesByTicker[ticker] ?? [];
		const openPositions = openByTicker.get(ticker) ?? [];

		if (candles.length === 0) {
			perTicker.push({
				ticker,
				lastBarTime: null,
				lastClose: null,
				signals: { longEntry: false, longExit: false, shortEntry: false, shortExit: false },
				openPositions
			});
			allOpen.push(...openPositions);
			continue;
		}

		const lastIndex = candles.length - 1;
		const lastBar = candles[lastIndex];
		const ctx: EvalContext = { candles, indicators: precomputeIndicators(spec, candles) };

		// Point-in-time evaluation at the last CLOSED bar — exactly the bar index
		// the engine would have evaluated; the act (fill) would land on next bar.
		const signals: ForwardSignals = {
			longEntry: evaluateGroup(spec.rules.longEntry, ctx, lastIndex),
			longExit: evaluateGroup(spec.rules.longExit, ctx, lastIndex),
			shortEntry: evaluateGroup(spec.rules.shortEntry, ctx, lastIndex),
			shortExit: evaluateGroup(spec.rules.shortExit, ctx, lastIndex)
		};

		if (signals.longEntry) pendingLong = true;
		if (signals.shortExit) pendingShortExit = true;

		const barMs = Date.parse(lastBar.t);
		if (Number.isFinite(barMs) && barMs > asOfMs) {
			asOfMs = barMs;
			asOf = lastBar.t;
		}

		perTicker.push({
			ticker,
			lastBarTime: lastBar.t,
			lastClose: lastBar.c,
			signals,
			openPositions
		});
		allOpen.push(...openPositions);
	}

	return {
		asOf,
		openPositions: allOpen,
		pendingLong,
		pendingShortExit,
		perTicker,
		warnings: backtest.warnings
	};
}

/**
 * Reconstruct the positions that were STILL OPEN at the latest bar from the engine
 * run. The engine force-closes every survivor at end-of-data with
 * `exitReason: 'endOfData'`, so those trades — and only those — represent the open
 * book. We read the position back from the trade's entry leg (the synthetic exit
 * is ignored). Grouped by ticker for the per-ticker view.
 */
function deriveOpenPositions(backtest: BacktestResult): Map<string, ForwardOpenPosition[]> {
	const byTicker = new Map<string, ForwardOpenPosition[]>();
	for (const trade of backtest.trades) {
		if (trade.exitReason !== 'endOfData') continue;
		const pos: ForwardOpenPosition = {
			ticker: trade.ticker,
			side: trade.side,
			qty: trade.qty,
			entryPrice: trade.entryPrice,
			entryTime: trade.entryTime
		};
		const list = byTicker.get(trade.ticker);
		if (list) list.push(pos);
		else byTicker.set(trade.ticker, [pos]);
	}
	return byTicker;
}

// ---------------------------------------------------------------------------
// Divergence monitor
// ---------------------------------------------------------------------------

/** Last equity point of a result, or the initial capital when the curve is empty. */
function lastEquity(result: BacktestResult): number {
	const curve = result.equityCurve;
	if (curve.length > 0) return curve[curve.length - 1].equity;
	return result.spec.risk.initialCapital;
}

/**
 * Drift summary between a stored backtest and a fresh "live" run of the same spec.
 * Pure + small: compares trade count and last realized equity. Two identical
 * results yield all-zero deltas and `identical: true`.
 */
export function divergence(backtest: BacktestResult, live: BacktestResult): Divergence {
	const tradeCountDelta = live.trades.length - backtest.trades.length;
	const lastEquityDelta = lastEquity(live) - lastEquity(backtest);
	return {
		tradeCountDelta,
		lastEquityDelta,
		identical: tradeCountDelta === 0 && lastEquityDelta === 0
	};
}
