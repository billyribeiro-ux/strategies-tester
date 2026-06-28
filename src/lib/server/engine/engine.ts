/**
 * The backtest engine — PURE. No network, no DB, no clock except `computedAt`.
 *
 * `runBacktest(spec, candlesByTicker)` precomputes every referenced indicator
 * per ticker, walks the union of all tickers' timestamps in chronological order,
 * evaluates entry/exit rules point-in-time at each bar's close, fills orders per
 * the execution model (default next-bar open — no look-ahead), applies slippage
 * and commission, manages stops/targets/trailing-stops intrabar, marks the
 * portfolio to market every timestamp, and finally derives metrics and curves.
 *
 * Determinism: identical (spec, candles) inputs always yield identical output,
 * with one cosmetic exception — `runId` and `computedAt`, which callers can
 * normalise before comparing (the determinism test does this).
 */

import type {
	AuditRecord,
	BacktestResult,
	Candle,
	EquityPoint,
	ExitReason,
	IndicatorInstance,
	ScaleOutTrigger,
	StrategySpec,
	Trade,
	TradeSide
} from '$lib/types';
import { newRunId } from '$lib/utils/id';
import { assertNever } from '$lib/utils/assert-never';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import { getComputeFn } from '../indicators/registry';
import { ParamReader } from '../indicators/compute';
import { alignToBase, resampleBySeconds } from './mtf';
import { evaluateGroup, type EvalContext, type IndicatorSeriesMap } from './evaluate';
import {
	computeDistribution,
	computeDrawdown,
	computeMetrics,
	computeMonthlyReturns
} from './metrics';

// ---------------------------------------------------------------------------
// Internal per-ticker working state
// ---------------------------------------------------------------------------

interface TickerData {
	ticker: string;
	candles: Candle[];
	ctx: EvalContext;
	/** timestamp ms → bar index, for cross-ticker timeline alignment. */
	indexByTime: Map<number, number>;
}

interface OpenPosition {
	ticker: string;
	side: TradeSide;
	qty: number;
	entryPrice: number; // average entry price (across pyramided adds)
	entryTime: string;
	entryBarIndex: number;
	stopPrice: number | null;
	targetPrice: number | null;
	/** Initial risk per share at entry (entryPrice - stopPrice), for R multiples. */
	initialRiskPerShare: number;
	/** Number of pyramided adds applied so far (0 = base entry only). */
	adds: number;
	/** Best/worst price seen since entry, for MAE/MFE. */
	highestSinceEntry: number;
	lowestSinceEntry: number;
	/** Trailing stop level, maintained intrabar; null when no trailing stop. */
	trailPrice: number | null;
	/** ATR value captured at entry, for atr-based stop/target/trail sizing. */
	atrAtEntry: number;
	/**
	 * §4c Scale-out: original position quantity at entry, the base for each
	 * level's fraction. Stays fixed as partial closes reduce `qty` and as adds
	 * grow it (adds raise this too so fractions track the live original size).
	 */
	originalQty: number;
	/**
	 * §4c Scale-out: number of ascending scale-out levels already fired for this
	 * position. Levels are processed in order, so this doubles as a cursor — only
	 * levels at index >= scaledLevels remain eligible.
	 */
	scaledLevels: number;
}

// ---------------------------------------------------------------------------
// Precompute
// ---------------------------------------------------------------------------

/** Seconds for a timeframe id, defaulting to daily when unknown. */
function timeframeSecondsOf(timeframe: string): number {
	return CAPABILITIES.timeframes.find((t) => t.id === timeframe)?.seconds ?? 86_400;
}

/**
 * Normalize a compute result into a component map (`number[]` → `{ value }`).
 */
function toSeriesMap(result: number[] | Record<string, number[]>): IndicatorSeriesMap {
	return Array.isArray(result) ? { value: result } : result;
}

/**
 * Compute every referenced indicator instance for one ticker into series indexed
 * by BASE bar. An indicator with no `timeframe` (or one not HIGHER than the
 * universe TF) is computed directly on the base candles (unchanged path). An
 * indicator referencing a HIGHER timeframe (spec §3) is computed on resampled
 * higher-TF bars and aligned back to base indices with NO look-ahead: at base
 * bar `t` it exposes only the most recently CLOSED higher-TF bar (see mtf.ts).
 *
 * `baseSeconds` is the universe timeframe's length in seconds, used to decide
 * which path each indicator takes.
 */
function precomputeIndicators(
	indicators: IndicatorInstance[],
	candles: Candle[],
	baseSeconds: number
): Record<string, IndicatorSeriesMap> {
	const out: Record<string, IndicatorSeriesMap> = {};
	const baseTimesMs = candles.map((c) => Date.parse(c.t));
	for (const inst of indicators) {
		const fn = getComputeFn(inst.type);
		if (!fn) continue; // validated upstream; skip unknown defensively

		const tfSeconds = inst.timeframe ? timeframeSecondsOf(inst.timeframe) : baseSeconds;
		// Higher-TF reference: resample up, compute on HTF bars, align back to base.
		// Equal or lower TF (and the no-timeframe case) use the base path unchanged —
		// a lower TF is never honoured (it would fabricate sub-bar data; validation
		// rejects it, but the engine clamps to base for safety).
		if (inst.timeframe && tfSeconds > baseSeconds) {
			const { bars, bucketEndMs } = resampleBySeconds(candles, tfSeconds);
			const htf = toSeriesMap(fn(bars, new ParamReader(inst.params), inst.priceSource));
			const aligned: IndicatorSeriesMap = {};
			for (const [component, series] of Object.entries(htf)) {
				aligned[component] = alignToBase(baseTimesMs, series, bucketEndMs);
			}
			out[inst.id] = aligned;
		} else {
			out[inst.id] = toSeriesMap(fn(candles, new ParamReader(inst.params), inst.priceSource));
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

/** Apply slippage to a fill price, always adverse to the trade direction. */
function applySlippage(
	price: number,
	side: TradeSide,
	isEntry: boolean,
	spec: StrategySpec
): number {
	const slip = spec.risk.slippage;
	// Adverse direction: entries fill worse (long pays more / short receives less),
	// exits fill worse (long sells lower / short buys higher).
	const adverseUp = (side === 'long' && isEntry) || (side === 'short' && !isEntry);
	let delta: number;
	switch (slip.mode) {
		case 'none':
			delta = 0;
			break;
		case 'percent':
			delta = price * (slip.percent / 100);
			break;
		case 'ticks':
			delta = slip.ticks * slip.tickSize;
			break;
		default:
			return assertNever(slip, 'Unknown slippage mode');
	}
	const filled = adverseUp ? price + delta : price - delta;
	return filled > 0 ? filled : price;
}

/** Commission for filling `qty` shares at `price`. */
function commissionFor(qty: number, price: number, spec: StrategySpec): number {
	const c = spec.risk.commission;
	switch (c.mode) {
		case 'none':
			return 0;
		case 'perShare':
			return qty * c.perShare;
		case 'perTrade':
			return c.perTrade;
		case 'percent':
			return qty * price * (c.percent / 100);
		default:
			return assertNever(c, 'Unknown commission mode');
	}
}

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

/**
 * Running aggregates over the trades CLOSED so far in the run, maintained in
 * `closePosition`. Used by fractional-Kelly sizing, which must size from
 * point-in-time stats only (never future trades) to stay leak-free.
 */
interface ClosedTradeStats {
	/** Trades closed with pnl > 0. */
	wins: number;
	/** Trades closed with pnl < 0. */
	losses: number;
	/** Sum of positive pnl across winning trades. */
	sumWin: number;
	/** Sum of |pnl| across losing trades (stored positive). */
	sumLoss: number;
}

/** Minimum closed trades before fractional-Kelly estimates an edge (else warmup). */
const KELLY_WARMUP_TRADES = 5;

/**
 * Conservative equity fraction used to BOOTSTRAP fractional-Kelly before enough
 * trades have closed to estimate an edge. A small percentEquity-style default
 * (2%) so a few trades can settle and feed the rolling stats; without it Kelly
 * could never open a first position and would never produce any stats at all.
 */
const KELLY_WARMUP_FRACTION = 0.02;

/**
 * Effective equity fraction to bet for a fractional-Kelly entry, computed from the
 * CLOSED-trade aggregates only (point-in-time → leak-free).
 *
 * - Warmup (fewer than KELLY_WARMUP_TRADES closed trades): fall back to a small
 *   conservative fixed fraction (KELLY_WARMUP_FRACTION) so positions can open and
 *   feed the rolling stats. Documented fallback (percentEquity-style).
 * - Post-warmup: `f* = max(0, W − (1−W)/R)` with `W = wins/total`,
 *   `R = avgWin/|avgLoss|`, then scaled by `fraction`. If the payoff ratio is
 *   undefined (no wins or no losses observed → avgWin/avgLoss 0) or R ≤ 0, f* = 0
 *   → no bet (size 0). A losing history (low W / small R) drives f* to 0 likewise.
 */
function kellyFraction(stats: ClosedTradeStats, fraction: number): number {
	const total = stats.wins + stats.losses;
	if (total < KELLY_WARMUP_TRADES) return fraction * KELLY_WARMUP_FRACTION;
	const avgWin = stats.wins > 0 ? stats.sumWin / stats.wins : 0;
	const avgLoss = stats.losses > 0 ? stats.sumLoss / stats.losses : 0;
	if (!(avgLoss > 0) || !(avgWin > 0)) return 0; // no payoff ratio definable → no bet
	const w = stats.wins / total;
	const r = avgWin / avgLoss;
	if (!(r > 0)) return 0;
	const fStar = Math.max(0, w - (1 - w) / r);
	return fraction * fStar;
}

/**
 * Shares to trade for a new entry given current equity and fill price.
 * `atrValue` is the referenced ATR series value at the fill bar (NaN when the
 * sizing mode does not reference an ATR), used only by `volatilityTarget`.
 * `stats` are the running CLOSED-trade aggregates as of the entry (point-in-time),
 * used only by `fractionalKelly`.
 */
function sizePosition(
	spec: StrategySpec,
	equity: number,
	fillPrice: number,
	stopPrice: number | null,
	atrValue: number,
	stats: ClosedTradeStats
): number {
	const sizing = spec.risk.positionSizing;
	if (fillPrice <= 0) return 0;
	switch (sizing.mode) {
		case 'fixedShares':
			return Math.max(0, Math.floor(sizing.shares));
		case 'fixedNotional':
			return Math.max(0, Math.floor(sizing.notional / fillPrice));
		case 'percentEquity':
			return Math.max(0, Math.floor((equity * (sizing.percent / 100)) / fillPrice));
		case 'riskBased': {
			if (stopPrice === null) return 0;
			const riskPerShare = Math.abs(fillPrice - stopPrice);
			if (riskPerShare <= 0) return 0;
			const riskCapital = equity * (sizing.riskPercent / 100);
			return Math.max(0, Math.floor(riskCapital / riskPerShare));
		}
		case 'volatilityTarget': {
			// shares ≈ floor((equity * targetVolPercent/100) / atrValue): scale exposure
			// inversely to per-bar volatility so each position carries a similar
			// volatility budget. Non-finite/≤0 ATR → size 0 (cannot size safely).
			if (!Number.isFinite(atrValue) || atrValue <= 0) return 0;
			const volBudget = equity * (sizing.targetVolPercent / 100);
			return Math.max(0, Math.floor(volBudget / atrValue));
		}
		case 'fractionalKelly': {
			// shares = floor(equity × fraction × f* / fillPrice). During warmup or with
			// no estimable edge, kellyFraction returns 0 → size 0 (no trade).
			const frac = kellyFraction(stats, sizing.fraction);
			if (!(frac > 0)) return 0;
			return Math.max(0, Math.floor((equity * frac) / fillPrice));
		}
		default:
			return assertNever(sizing, 'Unknown sizing mode');
	}
}

// ---------------------------------------------------------------------------
// Stop / target / trailing computation
// ---------------------------------------------------------------------------

function computeStopPrice(
	spec: StrategySpec,
	side: TradeSide,
	entryPrice: number,
	atrAtEntry: number
): number | null {
	const stop = spec.risk.stopLoss;
	switch (stop.mode) {
		case 'none':
			return null;
		case 'percent': {
			const d = entryPrice * (stop.percent / 100);
			return side === 'long' ? entryPrice - d : entryPrice + d;
		}
		case 'points':
			return side === 'long' ? entryPrice - stop.points : entryPrice + stop.points;
		case 'atr': {
			if (!Number.isFinite(atrAtEntry) || atrAtEntry <= 0) return null;
			const d = atrAtEntry * stop.multiple;
			return side === 'long' ? entryPrice - d : entryPrice + d;
		}
		default:
			return assertNever(stop, 'Unknown stop mode');
	}
}

function computeTargetPrice(
	spec: StrategySpec,
	side: TradeSide,
	entryPrice: number,
	stopPrice: number | null,
	atrAtEntry: number
): number | null {
	const tp = spec.risk.takeProfit;
	switch (tp.mode) {
		case 'none':
			return null;
		case 'percent': {
			const d = entryPrice * (tp.percent / 100);
			return side === 'long' ? entryPrice + d : entryPrice - d;
		}
		case 'rMultiple': {
			if (stopPrice === null) return null;
			const risk = Math.abs(entryPrice - stopPrice);
			const d = risk * tp.r;
			return side === 'long' ? entryPrice + d : entryPrice - d;
		}
		case 'atr': {
			if (!Number.isFinite(atrAtEntry) || atrAtEntry <= 0) return null;
			const d = atrAtEntry * tp.multiple;
			return side === 'long' ? entryPrice + d : entryPrice - d;
		}
		default:
			return assertNever(tp, 'Unknown take-profit mode');
	}
}

/** Distance used for the trailing stop, or null when no trailing stop. */
function trailDistance(spec: StrategySpec, refPrice: number, atrAtEntry: number): number | null {
	const tr = spec.risk.trailingStop;
	switch (tr.mode) {
		case 'none':
			return null;
		case 'percent':
			return refPrice * (tr.percent / 100);
		case 'atr':
			return Number.isFinite(atrAtEntry) && atrAtEntry > 0 ? atrAtEntry * tr.multiple : null;
		default:
			return assertNever(tr, 'Unknown trailing-stop mode');
	}
}

/** Read a single ATR ref's series value at a bar (NaN if missing/non-finite). */
function atrRefAtBar(td: TickerData, ref: string, barIndex: number): number {
	const series = td.ctx.indicators[ref]?.value;
	if (series && barIndex >= 0 && barIndex < series.length) {
		const v = series[barIndex];
		if (Number.isFinite(v)) return v;
	}
	return NaN;
}

/** Resolve the ATR value at a bar for the ATR ref used by any stop/target/trail. */
function atrAtBar(spec: StrategySpec, td: TickerData, barIndex: number): number {
	const refs = new Set<string>();
	if (spec.risk.stopLoss.mode === 'atr') refs.add(spec.risk.stopLoss.atrRef);
	if (spec.risk.takeProfit.mode === 'atr') refs.add(spec.risk.takeProfit.atrRef);
	if (spec.risk.trailingStop.mode === 'atr') refs.add(spec.risk.trailingStop.atrRef);
	for (const ref of refs) {
		const v = atrRefAtBar(td, ref, barIndex);
		if (Number.isFinite(v)) return v;
	}
	return NaN;
}

/** Resolve the ATR value at a bar for the volatilityTarget sizing ref (else NaN). */
function sizingAtrAtBar(spec: StrategySpec, td: TickerData, barIndex: number): number {
	const sizing = spec.risk.positionSizing;
	if (sizing.mode !== 'volatilityTarget') return NaN;
	return atrRefAtBar(td, sizing.atrRef, barIndex);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function runBacktest(
	spec: StrategySpec,
	candlesByTicker: Record<string, Candle[]>
): BacktestResult {
	const warnings: string[] = [];
	const initialCapital = spec.risk.initialCapital;
	const timeframeSeconds =
		CAPABILITIES.timeframes.find((t) => t.id === spec.universe.timeframe)?.seconds ?? 86_400;

	// Build per-ticker data (only tickers with candles participate).
	const tickers: TickerData[] = [];
	const usedCandles: Record<string, Candle[]> = {};
	for (const ticker of spec.universe.tickers) {
		const candles = candlesByTicker[ticker] ?? [];
		if (candles.length === 0) {
			warnings.push(`No data returned for ${ticker}; it was skipped.`);
			continue;
		}
		const indexByTime = new Map<number, number>();
		candles.forEach((c, i) => indexByTime.set(Date.parse(c.t), i));
		const ctx: EvalContext = {
			candles,
			indicators: precomputeIndicators(spec.indicators, candles, timeframeSeconds)
		};
		tickers.push({ ticker, candles, ctx, indexByTime });
		usedCandles[ticker] = candles;
	}

	// Union timeline of all tickers' timestamps, ascending.
	const timesSet = new Set<number>();
	for (const td of tickers) for (const c of td.candles) timesSet.add(Date.parse(c.t));
	const timeline = [...timesSet].sort((a, b) => a - b);

	// Portfolio state.
	let cash = initialCapital;
	const openPositions: OpenPosition[] = [];
	const trades: Trade[] = [];
	const equityCurve: EquityPoint[] = [];
	let cumulativePnl = 0;
	let barsInMarket = 0;
	let tradeSeq = 0;

	// Running aggregates over trades CLOSED so far, for fractional-Kelly sizing.
	// Updated in closePosition; read AS OF each entry → only already-closed trades
	// inform sizing, so it is point-in-time and leak-free.
	const closedStats: ClosedTradeStats = { wins: 0, losses: 0, sumWin: 0, sumLoss: 0 };

	// §costs Short borrow: annual rate (percent) charged per bar on short notional.
	// undefined/<=0 disables it. Precompute the per-bar fraction for this timeframe.
	const rawBorrowApr = spec.risk.shortBorrowAPR;
	const shortBorrowApr = typeof rawBorrowApr === 'number' && rawBorrowApr > 0 ? rawBorrowApr : null;
	const SECONDS_PER_YEAR = 31_557_600;
	const borrowPerBarRate =
		shortBorrowApr !== null ? (shortBorrowApr / 100) * (timeframeSeconds / SECONDS_PER_YEAR) : 0;

	const fillModel = spec.execution.fillOn;
	const orderType = spec.execution.orderType;
	// G1 / §2.2: 'close' and 'signalPrice' fill at the SIGNAL bar — the engine
	// cannot have known that price when the signal formed. These are research-only
	// and lookahead-optimistic; surface it loudly so results aren't mistaken for
	// realistic. 'nextOpen' (the default) is the only execution-realistic model.
	if (fillModel === 'close' || fillModel === 'signalPrice') {
		warnings.push(
			`Fill model "${fillModel}" fills at the signal bar and is lookahead-optimistic ` +
				`(violates next-bar-open execution). Treat results as research-only; use "nextOpen" for realistic fills.`
		);
	}
	const maxPositions = spec.risk.maxConcurrentPositions;
	const pyramiding = spec.risk.pyramiding;

	// §5 Time exit: force-close a position once held this many bars (next-open fill).
	const rawMaxBars = spec.risk.maxBarsInTrade;
	const maxBarsInTrade =
		typeof rawMaxBars === 'number' && rawMaxBars > 0 ? Math.floor(rawMaxBars) : null;

	// §5 Portfolio drawdown circuit-breaker: once equity is this far below its peak,
	// halt ALL new entries for the rest of the run. Managed exits still proceed.
	const rawDdStop = spec.risk.maxDrawdownStopPercent;
	const ddStopPct = typeof rawDdStop === 'number' && rawDdStop > 0 ? rawDdStop : null;
	let peakEquity = initialCapital;
	let entriesHalted = false;

	// §5 Portfolio heat cap: total open risk may not exceed this % of equity.
	const rawHeat = spec.risk.maxPortfolioHeatPercent;
	const heatCapPct = typeof rawHeat === 'number' && rawHeat > 0 ? rawHeat : null;
	let heatCapBlocks = 0;

	// §2.3 Liquidity cap: limit a single fill to a share of the fill bar's volume.
	// undefined/<=0 disables the cap. We warn ONCE per run if it ever bites.
	const rawCap = spec.execution.maxBarVolumePct;
	const liquidityCapPct = typeof rawCap === 'number' && rawCap > 0 ? rawCap : null;
	let liquidityCapHits = 0;

	/**
	 * Apply the liquidity cap to a desired (already-sized) quantity for a fill on
	 * `td` at `fillBarIndex`. Returns the capped quantity; counts a hit whenever a
	 * non-zero desire is reduced (including to zero) by the cap.
	 */
	function applyLiquidityCap(desiredQty: number, td: TickerData, fillBarIndex: number): number {
		if (liquidityCapPct === null || desiredQty <= 0) return desiredQty;
		const volume = td.candles[fillBarIndex].v;
		if (!Number.isFinite(volume) || volume <= 0) return desiredQty;
		const maxQty = Math.floor((volume * liquidityCapPct) / 100);
		if (desiredQty > maxQty) {
			liquidityCapHits++;
			return maxQty;
		}
		return desiredQty;
	}

	const tickerByName = new Map(tickers.map((t) => [t.ticker, t]));

	/** Mark-to-market equity at a timeline timestamp. */
	const markEquity = (timeMs: number): number => {
		let value = cash;
		for (const pos of openPositions) {
			const td = tickerByName.get(pos.ticker);
			if (!td) continue;
			const idx = td.indexByTime.get(timeMs);
			const price = idx !== undefined ? td.candles[idx].c : lastKnownClose(td, timeMs);
			if (Number.isFinite(price)) {
				// Long: cash (already net of cost) + market value of shares.
				// Short: cash (already includes proceeds) - cost to buy back.
				value += pos.side === 'long' ? pos.qty * price : -pos.qty * price;
			}
		}
		return value;
	};

	/** Last close at or before `timeMs` for a ticker (for marking gaps). */
	function lastKnownClose(td: TickerData, timeMs: number): number {
		let price = NaN;
		for (const c of td.candles) {
			const t = Date.parse(c.t);
			if (t > timeMs) break;
			price = c.c;
		}
		return price;
	}

	// Process each timeline bar in chronological order.
	for (let step = 0; step < timeline.length; step++) {
		const timeMs = timeline[step];

		// --- 1. Manage existing positions intrabar (stops/targets/trailing) on this bar.
		for (const td of tickers) {
			const idx = td.indexByTime.get(timeMs);
			if (idx === undefined) continue;
			const bar = td.candles[idx];
			for (const pos of openPositions) {
				if (pos.ticker !== td.ticker) continue;
				updateExcursions(pos, bar);
				maybeUpdateTrailing(pos, bar, spec);
			}
			// Resolve protective exits (intrabar) for this ticker's positions.
			// Ordering / stop precedence (§4c): the stop/target/trailing check runs
			// FIRST and fully closes a position when triggered. Only if nothing
			// protective fires do we take any reached scale-out levels — conservative:
			// a bar that also hits the stop exits the whole remainder at the stop and
			// no partial profit is booked. Both steps read only THIS bar's OHLC.
			const survivors: OpenPosition[] = [];
			for (const pos of openPositions) {
				if (pos.ticker !== td.ticker) {
					survivors.push(pos);
					continue;
				}
				const hit = checkProtectiveExit(pos, bar);
				if (hit) {
					closePosition(pos, hit.price, bar.t, idx, hit.reason);
					continue;
				}
				// No protective exit: take any partial-profit levels reached this bar.
				const fullyScaledOut = applyScaleOut(pos, bar, idx);
				if (!fullyScaledOut) survivors.push(pos);
			}
			openPositions.length = 0;
			openPositions.push(...survivors);
		}

		// --- 2. Time exits: a position held >= maxBarsInTrade is force-closed at the
		// NEXT bar's open (same look-ahead-safe path as a signal exit). The decision
		// uses only bars <= idx (the elapsed bar count), so it is leak-free. Reuses
		// the 'signalExit' reason — result.ts owns the ExitReason union and is not
		// edited here, so a dedicated 'timeExit' reason is not introduced.
		if (maxBarsInTrade !== null) {
			for (const td of tickers) {
				const idx = td.indexByTime.get(timeMs);
				if (idx === undefined) continue;
				const survivors: OpenPosition[] = [];
				for (const pos of openPositions) {
					if (pos.ticker !== td.ticker) {
						survivors.push(pos);
						continue;
					}
					const barsHeld = idx - pos.entryBarIndex;
					if (barsHeld >= maxBarsInTrade) {
						const fill = resolveFill(td, idx);
						if (fill) closePosition(pos, fill.price, fill.time, fill.barIndex, 'signalExit');
						else survivors.push(pos); // no next bar to fill on; carry to end-of-data
					} else {
						survivors.push(pos);
					}
				}
				openPositions.length = 0;
				openPositions.push(...survivors);
			}
		}

		// --- 3. Signal-based exits at the close of this bar.
		for (const td of tickers) {
			const idx = td.indexByTime.get(timeMs);
			if (idx === undefined) continue;
			const survivors: OpenPosition[] = [];
			for (const pos of openPositions) {
				if (pos.ticker !== td.ticker) {
					survivors.push(pos);
					continue;
				}
				const exitGroup = pos.side === 'long' ? spec.rules.longExit : spec.rules.shortExit;
				const signalled = evaluateGroup(exitGroup, td.ctx, idx);
				if (signalled) {
					const fill = resolveFill(td, idx);
					if (fill) closePosition(pos, fill.price, fill.time, fill.barIndex, 'signalExit');
					else survivors.push(pos); // no next bar to fill on; carry to end-of-data
				} else {
					survivors.push(pos);
				}
			}
			openPositions.length = 0;
			openPositions.push(...survivors);
		}

		// --- 4. Entries at the close of this bar (long then short, deterministic order).
		// Skipped entirely once the drawdown circuit-breaker has tripped.
		if (!entriesHalted) {
			for (const td of tickers) {
				const idx = td.indexByTime.get(timeMs);
				if (idx === undefined) continue;
				tryEntries(td, idx, 'long');
				tryEntries(td, idx, 'short');
			}
		}

		// --- 5. Mark to market and record equity for this timeline bar.
		const equity = markEquity(timeMs);
		equityCurve.push({ t: new Date(timeMs).toISOString(), equity });
		if (openPositions.length > 0) barsInMarket++;

		// §5 Drawdown circuit-breaker: track the running equity peak and, once marked
		// equity is >= ddStopPct below it, halt all new entries for the rest of the
		// run. Open positions continue to be managed/exited normally. Warn once.
		if (Number.isFinite(equity)) {
			if (equity > peakEquity) peakEquity = equity;
			if (ddStopPct !== null && !entriesHalted && peakEquity > 0) {
				const ddPct = ((peakEquity - equity) / peakEquity) * 100;
				if (ddPct >= ddStopPct) {
					entriesHalted = true;
					warnings.push(
						`Drawdown circuit-breaker tripped: equity fell ${ddPct.toFixed(2)}% from peak ` +
							`(limit ${ddStopPct}%). New entries halted for the rest of the run.`
					);
				}
			}
		}
	}

	// --- 6. End of data: close everything at each ticker's last close.
	for (const pos of [...openPositions]) {
		const td = tickerByName.get(pos.ticker);
		if (!td) continue;
		const lastIdx = td.candles.length - 1;
		const lastBar = td.candles[lastIdx];
		closePosition(pos, lastBar.c, lastBar.t, lastIdx, 'endOfData');
	}
	openPositions.length = 0;

	// Recompute the final equity point net of any end-of-data closes so the
	// curve ends at realized account value.
	if (timeline.length > 0) {
		const lastTime = timeline[timeline.length - 1];
		equityCurve[equityCurve.length - 1] = {
			t: new Date(lastTime).toISOString(),
			equity: cash
		};
	}

	// ----- Assemble result -----
	const drawdown = computeDrawdown(equityCurve);
	const monthlyReturns = computeMonthlyReturns(equityCurve);
	const distribution = computeDistribution(trades);
	const metrics = computeMetrics({
		trades,
		equity: equityCurve,
		initialCapital,
		totalBars: timeline.length,
		barsInMarket,
		timeframeSeconds
	});

	if (trades.length === 0) warnings.push('No trades were generated for this strategy and data.');

	if (liquidityCapHits > 0) {
		warnings.push(`Liquidity cap limited fill size on ${liquidityCapHits} orders.`);
	}

	if (heatCapBlocks > 0) {
		warnings.push(`Portfolio heat cap blocked ${heatCapBlocks} entries.`);
	}

	const computedAt = new Date().toISOString();
	const audit: AuditRecord = {
		fillModel,
		orderType: spec.execution.orderType,
		commissionMode: spec.risk.commission.mode,
		slippageMode: spec.risk.slippage.mode,
		initialCapital,
		liquidityCapPct,
		timeframe: spec.universe.timeframe,
		bars: timeline.length,
		tickers: tickers.map((t) => t.ticker),
		lookaheadOptimistic: fillModel === 'close' || fillModel === 'signalPrice',
		schemaVersion: spec.schemaVersion,
		computedAt
	};

	return {
		runId: newRunId(),
		spec,
		metrics,
		equityCurve,
		drawdown,
		trades,
		monthlyReturns,
		distribution,
		candles: usedCandles,
		warnings,
		audit,
		computedAt
	};

	// -----------------------------------------------------------------------
	// Closures over portfolio state
	// -----------------------------------------------------------------------

	function updateExcursions(pos: OpenPosition, bar: Candle) {
		if (bar.h > pos.highestSinceEntry) pos.highestSinceEntry = bar.h;
		if (bar.l < pos.lowestSinceEntry) pos.lowestSinceEntry = bar.l;
	}

	function maybeUpdateTrailing(pos: OpenPosition, bar: Candle, s: StrategySpec) {
		if (s.risk.trailingStop.mode === 'none') return;
		if (pos.side === 'long') {
			const dist = trailDistance(s, pos.highestSinceEntry, pos.atrAtEntry);
			if (dist === null) return;
			const candidate = pos.highestSinceEntry - dist;
			pos.trailPrice = pos.trailPrice === null ? candidate : Math.max(pos.trailPrice, candidate);
		} else {
			const dist = trailDistance(s, pos.lowestSinceEntry, pos.atrAtEntry);
			if (dist === null) return;
			const candidate = pos.lowestSinceEntry + dist;
			pos.trailPrice = pos.trailPrice === null ? candidate : Math.min(pos.trailPrice, candidate);
		}
	}

	/**
	 * Check stop / target / trailing intrabar. Stop precedence over target when
	 * both could trigger in the same bar (conservative). Returns the fill price
	 * and reason, or null if nothing triggered.
	 */
	function checkProtectiveExit(
		pos: OpenPosition,
		bar: Candle
	): { price: number; reason: ExitReason } | null {
		if (pos.side === 'long') {
			const stopLevel = effectiveLongStop(pos);
			if (stopLevel !== null && bar.l <= stopLevel) {
				return { price: stopLevel, reason: stopReason(pos, stopLevel) };
			}
			if (pos.targetPrice !== null && bar.h >= pos.targetPrice) {
				return { price: pos.targetPrice, reason: 'targetHit' };
			}
		} else {
			const stopLevel = effectiveShortStop(pos);
			if (stopLevel !== null && bar.h >= stopLevel) {
				return { price: stopLevel, reason: stopReason(pos, stopLevel) };
			}
			if (pos.targetPrice !== null && bar.l <= pos.targetPrice) {
				return { price: pos.targetPrice, reason: 'targetHit' };
			}
		}
		return null;
	}

	/** The active long stop = the higher of fixed stop and trailing stop. */
	function effectiveLongStop(pos: OpenPosition): number | null {
		if (pos.stopPrice === null && pos.trailPrice === null) return null;
		if (pos.stopPrice === null) return pos.trailPrice;
		if (pos.trailPrice === null) return pos.stopPrice;
		return Math.max(pos.stopPrice, pos.trailPrice);
	}

	/** The active short stop = the lower of fixed stop and trailing stop. */
	function effectiveShortStop(pos: OpenPosition): number | null {
		if (pos.stopPrice === null && pos.trailPrice === null) return null;
		if (pos.stopPrice === null) return pos.trailPrice;
		if (pos.trailPrice === null) return pos.stopPrice;
		return Math.min(pos.stopPrice, pos.trailPrice);
	}

	/** Distinguish a trailing-stop hit from a fixed-stop hit. */
	function stopReason(pos: OpenPosition, level: number): ExitReason {
		if (pos.trailPrice !== null && level === pos.trailPrice && pos.stopPrice !== pos.trailPrice) {
			return 'trailingStop';
		}
		if (pos.stopPrice !== null && level === pos.stopPrice) return 'stopHit';
		return pos.trailPrice !== null ? 'trailingStop' : 'stopHit';
	}

	/**
	 * Resolve the fill price/time/index for a signal at `idx` on ticker `td`.
	 * nextOpen → next bar's open (null if none). close/signalPrice → this close.
	 */
	function resolveFill(
		td: TickerData,
		idx: number
	): { price: number; time: string; barIndex: number } | null {
		switch (fillModel) {
			case 'nextOpen': {
				const next = idx + 1;
				if (next >= td.candles.length) return null;
				const bar = td.candles[next];
				return { price: bar.o, time: bar.t, barIndex: next };
			}
			case 'close':
			case 'signalPrice': {
				const bar = td.candles[idx];
				return { price: bar.c, time: bar.t, barIndex: idx };
			}
			default:
				return assertNever(fillModel, 'Unknown fill model');
		}
	}

	/**
	 * Resolve the ENTRY fill for a signal at bar `idx` on ticker `td`, honoring the
	 * configured order type (§5). Returns the fill price/time/index, or null when
	 * the order does NOT fill (no next bar, or a limit/stop order that the next bar
	 * never reaches — it expires; no resting orders persist across multiple bars).
	 *
	 * Leak-free: the order's reference price is the SIGNAL bar's close (known at
	 * decision time, index ≤ idx) and the fill is decided using ONLY the next bar's
	 * OHLC (the bar being filled on). No bar after the fill bar is ever consulted.
	 *
	 * - 'market': unchanged — delegates to `resolveFill` (next-bar open by default).
	 * - 'limit' (better price): LONG fills only if next.low ≤ ref, at min(next.open, ref);
	 *   SHORT fills only if next.high ≥ ref, at max(next.open, ref). A gap through the
	 *   limit fills at the (better) open.
	 * - 'stop' (worse price / breakout): LONG fills only if next.high ≥ ref, at
	 *   max(next.open, ref); SHORT fills only if next.low ≤ ref, at min(next.open, ref).
	 *   A gap through the stop fills at the open.
	 */
	function resolveEntryFill(
		td: TickerData,
		idx: number,
		side: TradeSide
	): { price: number; time: string; barIndex: number } | null {
		if (orderType === 'market') return resolveFill(td, idx);

		// limit/stop are inherently next-bar mechanics: reference = signal close at
		// `idx`, decision against the immediately following bar.
		const next = idx + 1;
		if (next >= td.candles.length) return null; // no bar to fill on → expire
		const ref = td.candles[idx].c;
		const bar = td.candles[next];

		let price: number;
		switch (orderType) {
			case 'limit': {
				if (side === 'long') {
					if (bar.l > ref) return null; // never dipped to the limit → expire
					price = Math.min(bar.o, ref); // gap-down fills at the better open
				} else {
					if (bar.h < ref) return null; // never rose to the limit → expire
					price = Math.max(bar.o, ref);
				}
				break;
			}
			case 'stop': {
				if (side === 'long') {
					if (bar.h < ref) return null; // never broke out up → expire
					price = Math.max(bar.o, ref); // gap-up fills at the open
				} else {
					if (bar.l > ref) return null; // never broke down → expire
					price = Math.min(bar.o, ref);
				}
				break;
			}
			default:
				return assertNever(orderType, 'Unknown order type');
		}
		return { price, time: bar.t, barIndex: next };
	}

	/** Open risk of a position = qty × |entry − stop|; 0 when it has no stop. */
	function positionRisk(qty: number, entryPrice: number, stopPrice: number | null): number {
		if (stopPrice === null) return 0;
		const perShare = Math.abs(entryPrice - stopPrice);
		return Number.isFinite(perShare) ? qty * perShare : 0;
	}

	/**
	 * §5 Portfolio heat cap. Returns true if adding a candidate position of
	 * `qty` shares (entry `fillPrice`, stop `stopPrice`) would push the summed open
	 * risk of all positions over heatCapPct% of `equity`. Candidates with no stop
	 * contribute no risk and are never blocked. Counts a block when it bites.
	 */
	function exceedsHeatCap(
		qty: number,
		fillPrice: number,
		stopPrice: number | null,
		equity: number
	): boolean {
		if (heatCapPct === null || stopPrice === null) return false;
		const candidateRisk = positionRisk(qty, fillPrice, stopPrice);
		if (candidateRisk <= 0) return false;
		let openRisk = 0;
		for (const p of openPositions) openRisk += positionRisk(p.qty, p.entryPrice, p.stopPrice);
		const budget = equity * (heatCapPct / 100);
		if (openRisk + candidateRisk > budget) {
			heatCapBlocks++;
			return true;
		}
		return false;
	}

	function tryEntries(td: TickerData, idx: number, side: TradeSide) {
		const entryGroup = side === 'long' ? spec.rules.longEntry : spec.rules.shortEntry;
		if (!evaluateGroup(entryGroup, td.ctx, idx)) return;

		const existing = openPositions.find((p) => p.ticker === td.ticker && p.side === side);
		if (existing) {
			// Pyramiding: allow up to `pyramiding` additional adds.
			if (existing.adds >= pyramiding) return;
			addToPosition(existing, td, idx, side);
			return;
		}

		if (openPositions.length >= maxPositions) return;
		openPosition(td, idx, side);
	}

	function openPosition(td: TickerData, idx: number, side: TradeSide) {
		const fill = resolveEntryFill(td, idx, side);
		if (!fill) return; // no fill: no next bar, or limit/stop order expired unreached
		const rawPrice = fill.price;
		const fillPrice = applySlippage(rawPrice, side, true, spec);
		if (!(fillPrice > 0)) return;

		const atrAtEntry = atrAtBar(spec, td, fill.barIndex);
		const provisionalStop = computeStopPrice(spec, side, fillPrice, atrAtEntry);
		// Size from marked-to-market equity at the fill bar (cash + open positions).
		const equity = markEquity(Date.parse(td.candles[fill.barIndex].t));
		const sizingAtr = sizingAtrAtBar(spec, td, fill.barIndex);
		const desiredQty = sizePosition(
			spec,
			equity,
			fillPrice,
			provisionalStop,
			sizingAtr,
			closedStats
		);
		// §5 Portfolio heat cap: skip the entry if it would push total open risk
		// (qty × |entry − stop| across open positions + this one) over the limit.
		if (desiredQty > 0 && exceedsHeatCap(desiredQty, fillPrice, provisionalStop, equity)) return;
		// §2.3 Liquidity cap: never fill more than the allowed share of bar volume.
		const qty = applyLiquidityCap(desiredQty, td, fill.barIndex);
		if (qty <= 0) return;

		const cost = qty * fillPrice;
		const commission = commissionFor(qty, fillPrice, spec);
		// Cash accounting: longs pay cash + fees; shorts receive proceeds - fees.
		cash += side === 'long' ? -(cost + commission) : cost - commission;

		const stopPrice = provisionalStop;
		const targetPrice = computeTargetPrice(spec, side, fillPrice, stopPrice, atrAtEntry);

		const pos: OpenPosition = {
			ticker: td.ticker,
			side,
			qty,
			entryPrice: fillPrice,
			entryTime: fill.time,
			entryBarIndex: fill.barIndex,
			stopPrice,
			targetPrice,
			initialRiskPerShare: stopPrice !== null ? Math.abs(fillPrice - stopPrice) : NaN,
			adds: 0,
			highestSinceEntry: fillPrice,
			lowestSinceEntry: fillPrice,
			trailPrice: null,
			atrAtEntry,
			originalQty: qty,
			scaledLevels: 0
		};
		// Seed entry-bar excursion with the fill bar's range.
		const fillBar = td.candles[fill.barIndex];
		updateExcursions(pos, fillBar);
		openPositions.push(pos);
	}

	function addToPosition(pos: OpenPosition, td: TickerData, idx: number, side: TradeSide) {
		const fill = resolveEntryFill(td, idx, side);
		if (!fill) return; // no fill: no next bar, or limit/stop order expired unreached
		const fillPrice = applySlippage(fill.price, side, true, spec);
		if (!(fillPrice > 0)) return;
		const equity = markEquity(Date.parse(td.candles[fill.barIndex].t));
		const sizingAtr = sizingAtrAtBar(spec, td, fill.barIndex);
		const desiredAddQty = sizePosition(
			spec,
			equity,
			fillPrice,
			pos.stopPrice,
			sizingAtr,
			closedStats
		);
		// §2.3 Liquidity cap also constrains pyramided adds.
		const addQty = applyLiquidityCap(desiredAddQty, td, fill.barIndex);
		if (addQty <= 0) return;

		const cost = addQty * fillPrice;
		const commission = commissionFor(addQty, fillPrice, spec);
		cash += side === 'long' ? -(cost + commission) : cost - commission;

		// New average entry price.
		const totalQty = pos.qty + addQty;
		pos.entryPrice = (pos.entryPrice * pos.qty + fillPrice * addQty) / totalQty;
		pos.qty = totalQty;
		// §4c Scale-out: grow the original-qty base by the add so each level's
		// fraction tracks the live full size (it is the base for round(orig × frac)).
		pos.originalQty += addQty;
		pos.adds += 1;
		// Keep the original stop/target geometry (recompute risk from avg price).
		if (pos.stopPrice !== null) pos.initialRiskPerShare = Math.abs(pos.entryPrice - pos.stopPrice);
	}

	/**
	 * Settle an exit of `qty` shares of `pos` at `rawExitPrice` (pre-slippage),
	 * pushing one Trade and updating cash / cumulativePnl / Kelly stats. The single
	 * code path for BOTH full closes and §4c scale-out partial closes; `qty` is the
	 * number of shares being closed (≤ pos.qty) and the trade's R-multiple and
	 * MAE/MFE use the position's entry geometry, so a partial inherits the runner's
	 * stop/risk. Leak-free: only the supplied (current/decided) bar's price is used;
	 * the caller never passes a future price. Does NOT mutate pos.qty — callers do.
	 */
	function settleExit(
		pos: OpenPosition,
		qty: number,
		rawExitPrice: number,
		exitTime: string,
		exitBarIndex: number,
		reason: ExitReason
	) {
		const exitPrice = applySlippage(rawExitPrice, pos.side, false, spec);
		const proceeds = qty * exitPrice;
		const commission = commissionFor(qty, exitPrice, spec);
		// Cash settle: longs receive proceeds - fees; shorts pay to buy back + fees.
		cash += pos.side === 'long' ? proceeds - commission : -(proceeds + commission);

		// §costs Short borrow: accrue per bar held on the short's entry notional for
		// the qty being closed, then deduct from cash and the trade's P&L at close.
		// Longs accrue nothing. Summed at close so it is deterministic and fully
		// reflected here; a partial close accrues only on its own qty.
		const barsHeld = Math.max(0, exitBarIndex - pos.entryBarIndex);
		const borrowCost =
			pos.side === 'short' && borrowPerBarRate > 0
				? pos.entryPrice * qty * borrowPerBarRate * barsHeld
				: 0;
		if (borrowCost > 0) cash -= borrowCost;

		const grossPnl =
			pos.side === 'long' ? (exitPrice - pos.entryPrice) * qty : (pos.entryPrice - exitPrice) * qty;
		// Entry commission is already reflected in cash; approximate per-trade net
		// P&L by subtracting both legs' commissions and any borrow cost from the gross.
		const entryCommission = commissionFor(qty, pos.entryPrice, spec);
		const pnl = grossPnl - commission - entryCommission - borrowCost;
		const entryNotional = pos.entryPrice * qty;
		const pnlPct = entryNotional > 0 ? pnl / entryNotional : 0;
		const rMultiple =
			pos.stopPrice !== null && pos.initialRiskPerShare > 0
				? pnl / (pos.initialRiskPerShare * qty)
				: NaN;

		cumulativePnl += pnl;

		// Update the running CLOSED-trade aggregates for fractional-Kelly sizing. This
		// happens at close, so a later entry's sizing only ever sees trades that have
		// already settled (point-in-time / leak-free).
		if (pnl > 0) {
			closedStats.wins += 1;
			closedStats.sumWin += pnl;
		} else if (pnl < 0) {
			closedStats.losses += 1;
			closedStats.sumLoss += -pnl;
		}

		// MAE/MFE as fractions of entry price over the holding period.
		const mae =
			pos.side === 'long'
				? (pos.lowestSinceEntry - pos.entryPrice) / pos.entryPrice
				: (pos.entryPrice - pos.highestSinceEntry) / pos.entryPrice;
		const mfe =
			pos.side === 'long'
				? (pos.highestSinceEntry - pos.entryPrice) / pos.entryPrice
				: (pos.entryPrice - pos.lowestSinceEntry) / pos.entryPrice;

		trades.push({
			id: `trade_${++tradeSeq}`,
			ticker: pos.ticker,
			side: pos.side,
			entryTime: pos.entryTime,
			entryPrice: pos.entryPrice,
			exitTime,
			exitPrice,
			qty,
			stopPrice: pos.stopPrice,
			targetPrice: pos.targetPrice,
			pnl,
			pnlPct,
			rMultiple,
			cumulativePnl,
			mae: Math.min(0, mae),
			mfe: Math.max(0, mfe),
			exitReason: reason,
			barsHeld
		});
	}

	function closePosition(
		pos: OpenPosition,
		rawExitPrice: number,
		exitTime: string,
		exitBarIndex: number,
		reason: ExitReason
	) {
		settleExit(pos, pos.qty, rawExitPrice, exitTime, exitBarIndex, reason);
	}

	/**
	 * §4c Scale-out price for a level: the profit target as a concrete price,
	 * derived from entry geometry. `rMultiple` needs a stop (null otherwise → the
	 * level is unfirable and skipped); `percent` is off the entry price. Long
	 * targets are above entry, short targets below.
	 */
	function scaleOutLevelPrice(pos: OpenPosition, trigger: ScaleOutTrigger): number | null {
		switch (trigger.kind) {
			case 'rMultiple': {
				if (pos.stopPrice === null || !(pos.initialRiskPerShare > 0)) return null;
				const d = pos.initialRiskPerShare * trigger.r;
				return pos.side === 'long' ? pos.entryPrice + d : pos.entryPrice - d;
			}
			case 'percent': {
				const d = pos.entryPrice * (trigger.percent / 100);
				return pos.side === 'long' ? pos.entryPrice + d : pos.entryPrice - d;
			}
			default:
				return assertNever(trigger, 'Unknown scale-out trigger kind');
		}
	}

	/**
	 * §4c Scale-out: take any not-yet-hit partial-profit levels reached on `bar`,
	 * in ascending order. Each fires once when price reaches its target (long:
	 * high ≥ level; short: low ≤ level), closing round(originalQty × fraction)
	 * shares (clamped to the remaining qty) at the LEVEL PRICE via settleExit and
	 * reducing pos.qty. Returns true if the position was fully consumed by the
	 * levels (qty reached 0), so the caller drops it.
	 *
	 * Leak-free: it reads ONLY this bar's OHLC (exactly like stops/targets) and
	 * fills at the deterministic level price, never a future bar. Stop precedence
	 * is enforced by the caller: protective exits are checked FIRST, so a bar that
	 * also hits the stop fully closes the remainder at the stop and this never runs.
	 */
	function applyScaleOut(pos: OpenPosition, bar: Candle, barIndex: number): boolean {
		const scaleOut = spec.risk.scaleOut;
		if (!scaleOut || scaleOut.levels.length === 0) return false;
		while (pos.scaledLevels < scaleOut.levels.length) {
			const level = scaleOut.levels[pos.scaledLevels];
			const levelPrice = scaleOutLevelPrice(pos, level.trigger);
			if (levelPrice === null) {
				// Unfirable level (e.g. rMultiple with no stop) — consume it and move on
				// so later levels stay reachable; validation already flags this config.
				pos.scaledLevels += 1;
				continue;
			}
			const reached = pos.side === 'long' ? bar.h >= levelPrice : bar.l <= levelPrice;
			if (!reached) break; // ascending: nothing further can be reached this bar
			pos.scaledLevels += 1;
			// Fraction is of the ORIGINAL qty; never close more than what remains.
			const wanted = Math.round(pos.originalQty * level.fraction);
			const qty = Math.min(wanted, pos.qty);
			if (qty <= 0) continue; // tiny position → this level closes nothing; skip
			settleExit(pos, qty, levelPrice, bar.t, barIndex, 'targetHit');
			pos.qty -= qty;
			if (pos.qty <= 0) return true; // levels fully consumed the position
		}
		return false;
	}
}
