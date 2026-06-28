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
	StrategySpec,
	Trade,
	TradeSide
} from '$lib/types';
import { newRunId } from '$lib/utils/id';
import { assertNever } from '$lib/utils/assert-never';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import { getComputeFn } from '../indicators/registry';
import { ParamReader } from '../indicators/compute';
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
}

// ---------------------------------------------------------------------------
// Precompute
// ---------------------------------------------------------------------------

/** Compute every referenced indicator instance for one ticker into series. */
function precomputeIndicators(
	indicators: IndicatorInstance[],
	candles: Candle[]
): Record<string, IndicatorSeriesMap> {
	const out: Record<string, IndicatorSeriesMap> = {};
	for (const inst of indicators) {
		const fn = getComputeFn(inst.type);
		if (!fn) continue; // validated upstream; skip unknown defensively
		const result = fn(candles, new ParamReader(inst.params), inst.priceSource);
		if (Array.isArray(result)) {
			out[inst.id] = { value: result };
		} else {
			out[inst.id] = result;
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

/** Shares to trade for a new entry given current equity and fill price. */
function sizePosition(
	spec: StrategySpec,
	equity: number,
	fillPrice: number,
	stopPrice: number | null
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

/** Resolve the ATR value at a bar for the ATR ref used by any risk mode. */
function atrAtBar(spec: StrategySpec, td: TickerData, barIndex: number): number {
	const refs = new Set<string>();
	if (spec.risk.stopLoss.mode === 'atr') refs.add(spec.risk.stopLoss.atrRef);
	if (spec.risk.takeProfit.mode === 'atr') refs.add(spec.risk.takeProfit.atrRef);
	if (spec.risk.trailingStop.mode === 'atr') refs.add(spec.risk.trailingStop.atrRef);
	for (const ref of refs) {
		const series = td.ctx.indicators[ref]?.value;
		if (series && barIndex >= 0 && barIndex < series.length) {
			const v = series[barIndex];
			if (Number.isFinite(v)) return v;
		}
	}
	return NaN;
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
			indicators: precomputeIndicators(spec.indicators, candles)
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

	const fillModel = spec.execution.fillOn;
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
			const survivors: OpenPosition[] = [];
			for (const pos of openPositions) {
				if (pos.ticker !== td.ticker) {
					survivors.push(pos);
					continue;
				}
				const hit = checkProtectiveExit(pos, bar);
				if (hit) {
					closePosition(pos, hit.price, bar.t, idx, hit.reason);
				} else {
					survivors.push(pos);
				}
			}
			openPositions.length = 0;
			openPositions.push(...survivors);
		}

		// --- 2. Signal-based exits at the close of this bar.
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

		// --- 3. Entries at the close of this bar (long then short, deterministic order).
		for (const td of tickers) {
			const idx = td.indexByTime.get(timeMs);
			if (idx === undefined) continue;
			tryEntries(td, idx, 'long');
			tryEntries(td, idx, 'short');
		}

		// --- 4. Mark to market and record equity for this timeline bar.
		const equity = markEquity(timeMs);
		equityCurve.push({ t: new Date(timeMs).toISOString(), equity });
		if (openPositions.length > 0) barsInMarket++;
	}

	// --- 5. End of data: close everything at each ticker's last close.
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
		const fill = resolveFill(td, idx);
		if (!fill) return; // no next bar to fill on
		const rawPrice = fill.price;
		const fillPrice = applySlippage(rawPrice, side, true, spec);
		if (!(fillPrice > 0)) return;

		const atrAtEntry = atrAtBar(spec, td, fill.barIndex);
		const provisionalStop = computeStopPrice(spec, side, fillPrice, atrAtEntry);
		// Size from marked-to-market equity at the fill bar (cash + open positions).
		const equity = markEquity(Date.parse(td.candles[fill.barIndex].t));
		const desiredQty = sizePosition(spec, equity, fillPrice, provisionalStop);
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
			atrAtEntry
		};
		// Seed entry-bar excursion with the fill bar's range.
		const fillBar = td.candles[fill.barIndex];
		updateExcursions(pos, fillBar);
		openPositions.push(pos);
	}

	function addToPosition(pos: OpenPosition, td: TickerData, idx: number, side: TradeSide) {
		const fill = resolveFill(td, idx);
		if (!fill) return;
		const fillPrice = applySlippage(fill.price, side, true, spec);
		if (!(fillPrice > 0)) return;
		const equity = markEquity(Date.parse(td.candles[fill.barIndex].t));
		const desiredAddQty = sizePosition(spec, equity, fillPrice, pos.stopPrice);
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
		pos.adds += 1;
		// Keep the original stop/target geometry (recompute risk from avg price).
		if (pos.stopPrice !== null) pos.initialRiskPerShare = Math.abs(pos.entryPrice - pos.stopPrice);
	}

	function closePosition(
		pos: OpenPosition,
		rawExitPrice: number,
		exitTime: string,
		exitBarIndex: number,
		reason: ExitReason
	) {
		const exitPrice = applySlippage(rawExitPrice, pos.side, false, spec);
		const proceeds = pos.qty * exitPrice;
		const commission = commissionFor(pos.qty, exitPrice, spec);
		// Cash settle: longs receive proceeds - fees; shorts pay to buy back + fees.
		cash += pos.side === 'long' ? proceeds - commission : -(proceeds + commission);

		const grossPnl =
			pos.side === 'long'
				? (exitPrice - pos.entryPrice) * pos.qty
				: (pos.entryPrice - exitPrice) * pos.qty;
		// Entry commission is already reflected in cash; approximate per-trade net
		// P&L by subtracting both legs' commissions from the gross.
		const entryCommission = commissionFor(pos.qty, pos.entryPrice, spec);
		const pnl = grossPnl - commission - entryCommission;
		const entryNotional = pos.entryPrice * pos.qty;
		const pnlPct = entryNotional > 0 ? pnl / entryNotional : 0;
		const rMultiple =
			pos.stopPrice !== null && pos.initialRiskPerShare > 0
				? pnl / (pos.initialRiskPerShare * pos.qty)
				: NaN;

		cumulativePnl += pnl;

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
			qty: pos.qty,
			stopPrice: pos.stopPrice,
			targetPrice: pos.targetPrice,
			pnl,
			pnlPct,
			rMultiple,
			cumulativePnl,
			mae: Math.min(0, mae),
			mfe: Math.max(0, mfe),
			exitReason: reason,
			barsHeld: Math.max(0, exitBarIndex - pos.entryBarIndex)
		});
	}
}
