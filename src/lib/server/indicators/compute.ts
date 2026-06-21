/**
 * Pure indicator implementations. Each function takes the full candle series,
 * a typed parameter accessor, and the chosen price source, returning either a
 * single `number[]` (single-output indicator) or a `Record<component, number[]>`
 * (multi-output), aligned 1:1 with `candles` and filled with `NaN` during the
 * warm-up window.
 *
 * POINT-IN-TIME: value at index `i` uses only candles[0..i]. No look-ahead.
 *
 * Indicators that are intrinsically based on the bar's high/low/close
 * (ATR, Stochastic, ADX, Donchian, CCI) ignore `priceSource` per the contract.
 */

import type { Candle, ParamValue, PriceField } from '$lib/types';
import {
	ema,
	priceSeries,
	rollingHighest,
	rollingLowest,
	rollingStdDev,
	sma,
	trueRange,
	wilderSmooth,
	wma
} from '../engine/series';

/** Output of a single compute function: one series, or named series. */
export type ComputeOutput = number[] | Record<string, number[]>;

export type ComputeFn = (
	candles: Candle[],
	params: ParamReader,
	priceSource: PriceField
) => ComputeOutput;

/** Strongly-typed, defensive reader over an indicator's `params` map. */
export class ParamReader {
	constructor(private readonly params: Record<string, ParamValue>) {}

	/** Integer param with a fallback; coerces and floors numeric input. */
	int(name: string, fallback: number): number {
		const v = this.params[name];
		if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
		return fallback;
	}

	/** Float param with a fallback. */
	float(name: string, fallback: number): number {
		const v = this.params[name];
		if (typeof v === 'number' && Number.isFinite(v)) return v;
		return fallback;
	}

	/** String/enum param with a fallback. */
	str(name: string, fallback: string): string {
		const v = this.params[name];
		return typeof v === 'string' ? v : fallback;
	}
}

const filled = (n: number): number[] => new Array<number>(n).fill(NaN);

// ---------------------------------------------------------------------------
// Moving averages
// ---------------------------------------------------------------------------

export const computeSMA: ComputeFn = (candles, params, src) => {
	const period = Math.max(1, params.int('period', 20));
	return sma(priceSeries(candles, src), period);
};

export const computeEMA: ComputeFn = (candles, params, src) => {
	const period = Math.max(1, params.int('period', 21));
	return ema(priceSeries(candles, src), period);
};

export const computeWMA: ComputeFn = (candles, params, src) => {
	const period = Math.max(1, params.int('period', 20));
	return wma(priceSeries(candles, src), period);
};

// ---------------------------------------------------------------------------
// VWAP — session-anchored (resets each calendar day in ET) or continuous.
// ---------------------------------------------------------------------------

export const computeVWAP: ComputeFn = (candles, params, src) => {
	const anchor = params.str('anchor', 'session');
	const price = priceSeries(candles, src);
	const n = candles.length;
	const out = filled(n);
	let cumPV = 0;
	let cumV = 0;
	let currentDay = '';
	for (let i = 0; i < n; i++) {
		if (anchor === 'session') {
			const day = candles[i].t.slice(0, 10); // YYYY-MM-DD bucket
			if (day !== currentDay) {
				cumPV = 0;
				cumV = 0;
				currentDay = day;
			}
		}
		const v = candles[i].v;
		cumPV += price[i] * v;
		cumV += v;
		out[i] = cumV > 0 ? cumPV / cumV : NaN;
	}
	return out;
};

// ---------------------------------------------------------------------------
// RSI (Wilder)
// ---------------------------------------------------------------------------

export const computeRSI: ComputeFn = (candles, params, src) => {
	const period = Math.max(1, params.int('period', 14));
	const price = priceSeries(candles, src);
	const n = price.length;
	const out = filled(n);
	if (n < period + 1) return out;

	const gains = new Array<number>(n).fill(0);
	const losses = new Array<number>(n).fill(0);
	for (let i = 1; i < n; i++) {
		const change = price[i] - price[i - 1];
		gains[i] = change > 0 ? change : 0;
		losses[i] = change < 0 ? -change : 0;
	}

	// Seed averages over the first `period` changes (indices 1..period).
	let avgGain = 0;
	let avgLoss = 0;
	for (let i = 1; i <= period; i++) {
		avgGain += gains[i];
		avgLoss += losses[i];
	}
	avgGain /= period;
	avgLoss /= period;
	out[period] = rsiFrom(avgGain, avgLoss);

	for (let i = period + 1; i < n; i++) {
		avgGain = (avgGain * (period - 1) + gains[i]) / period;
		avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
		out[i] = rsiFrom(avgGain, avgLoss);
	}
	return out;
};

function rsiFrom(avgGain: number, avgLoss: number): number {
	if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
	const rs = avgGain / avgLoss;
	return 100 - 100 / (1 + rs);
}

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------

export const computeMACD: ComputeFn = (candles, params, src) => {
	const fast = Math.max(1, params.int('fast', 12));
	const slow = Math.max(2, params.int('slow', 26));
	const signalPeriod = Math.max(1, params.int('signal', 9));
	const price = priceSeries(candles, src);
	const n = price.length;

	const fastEma = ema(price, fast);
	const slowEma = ema(price, slow);
	const macd = filled(n);
	for (let i = 0; i < n; i++) {
		if (!Number.isNaN(fastEma[i]) && !Number.isNaN(slowEma[i])) {
			macd[i] = fastEma[i] - slowEma[i];
		}
	}

	// Signal = EMA of the MACD line over its valid (non-NaN) tail only, so the
	// signal EMA is seeded from real MACD values rather than NaN.
	const firstValid = macd.findIndex((v) => !Number.isNaN(v));
	const signal = filled(n);
	if (firstValid !== -1) {
		const tail = macd.slice(firstValid);
		const tailSignal = ema(tail, signalPeriod);
		for (let i = 0; i < tailSignal.length; i++) signal[firstValid + i] = tailSignal[i];
	}

	const histogram = filled(n);
	for (let i = 0; i < n; i++) {
		if (!Number.isNaN(macd[i]) && !Number.isNaN(signal[i])) {
			histogram[i] = macd[i] - signal[i];
		}
	}
	return { macd, signal, histogram };
};

// ---------------------------------------------------------------------------
// ATR — uses H/L/C only
// ---------------------------------------------------------------------------

export const computeATR: ComputeFn = (candles, params) => {
	const period = Math.max(1, params.int('period', 14));
	const tr = trueRange(candles);
	// Wilder smoothing seeded from the first `period` true ranges. trueRange[0]
	// exists (high-low) but Wilder traditionally averages the first `period`.
	return wilderSmooth(tr, period);
};

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

export const computeBollinger: ComputeFn = (candles, params, src) => {
	const period = Math.max(2, params.int('period', 20));
	const mult = params.float('stdDev', 2);
	const price = priceSeries(candles, src);
	const middle = sma(price, period);
	const sd = rollingStdDev(price, period, middle);
	const n = price.length;
	const upper = filled(n);
	const lower = filled(n);
	for (let i = 0; i < n; i++) {
		if (!Number.isNaN(middle[i]) && !Number.isNaN(sd[i])) {
			upper[i] = middle[i] + mult * sd[i];
			lower[i] = middle[i] - mult * sd[i];
		}
	}
	return { upper, middle, lower };
};

// ---------------------------------------------------------------------------
// Stochastic — uses H/L/C only
// ---------------------------------------------------------------------------

export const computeStochastic: ComputeFn = (candles, params) => {
	const kPeriod = Math.max(1, params.int('kPeriod', 14));
	const dPeriod = Math.max(1, params.int('dPeriod', 3));
	const smooth = Math.max(1, params.int('smooth', 3));
	const n = candles.length;
	const highs = candles.map((c) => c.h);
	const lows = candles.map((c) => c.l);
	const highestHigh = rollingHighest(highs, kPeriod);
	const lowestLow = rollingLowest(lows, kPeriod);

	const rawK = filled(n);
	for (let i = 0; i < n; i++) {
		const hh = highestHigh[i];
		const ll = lowestLow[i];
		if (Number.isNaN(hh) || Number.isNaN(ll)) continue;
		const range = hh - ll;
		rawK[i] = range === 0 ? 50 : ((candles[i].c - ll) / range) * 100;
	}
	// %K smoothed by `smooth`, %D = SMA of %K over `dPeriod`.
	const k = smaIgnoringWarmup(rawK, smooth);
	const d = smaIgnoringWarmup(k, dPeriod);
	return { k, d };
};

// ---------------------------------------------------------------------------
// ADX / +DI / -DI (Wilder) — uses H/L/C only
// ---------------------------------------------------------------------------

export const computeADX: ComputeFn = (candles, params) => {
	const period = Math.max(1, params.int('period', 14));
	const n = candles.length;
	const adx = filled(n);
	const plusDI = filled(n);
	const minusDI = filled(n);
	if (n < 2) return { adx, plusDI, minusDI };

	const tr = new Array<number>(n).fill(0);
	const plusDM = new Array<number>(n).fill(0);
	const minusDM = new Array<number>(n).fill(0);
	for (let i = 1; i < n; i++) {
		const up = candles[i].h - candles[i - 1].h;
		const down = candles[i - 1].l - candles[i].l;
		plusDM[i] = up > down && up > 0 ? up : 0;
		minusDM[i] = down > up && down > 0 ? down : 0;
		const c = candles[i];
		const prevClose = candles[i - 1].c;
		tr[i] = Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
	}

	// Wilder-smoothed sums over indices 1..n-1.
	const smTR = wilderSum(tr, period);
	const smPlus = wilderSum(plusDM, period);
	const smMinus = wilderSum(minusDM, period);

	const dx = filled(n);
	for (let i = 0; i < n; i++) {
		if (Number.isNaN(smTR[i]) || smTR[i] === 0) continue;
		const pdi = (smPlus[i] / smTR[i]) * 100;
		const mdi = (smMinus[i] / smTR[i]) * 100;
		plusDI[i] = pdi;
		minusDI[i] = mdi;
		const denom = pdi + mdi;
		dx[i] = denom === 0 ? 0 : (Math.abs(pdi - mdi) / denom) * 100;
	}

	// ADX = Wilder smoothing of DX. DX first valid at index `period`; ADX needs
	// another `period` DX values.
	const firstDx = dx.findIndex((v) => !Number.isNaN(v));
	if (firstDx !== -1) {
		const tail = dx.slice(firstDx);
		const adxTail = wilderSmooth(tail, period);
		for (let i = 0; i < adxTail.length; i++) adx[firstDx + i] = adxTail[i];
	}
	return { adx, plusDI, minusDI };
};

/**
 * Wilder running sum used by ADX directional indicators. The smoothed value at
 * index `i` for series starting its first meaningful value at index 1:
 *   first sum (at index `period`) = sum of values[1..period]
 *   thereafter: sum = prevSum - prevSum/period + value[i]
 */
function wilderSum(values: number[], period: number): number[] {
	const n = values.length;
	const out = filled(n);
	if (n <= period) return out;
	let sum = 0;
	for (let i = 1; i <= period; i++) sum += values[i];
	out[period] = sum;
	for (let i = period + 1; i < n; i++) {
		sum = sum - sum / period + values[i];
		out[i] = sum;
	}
	return out;
}

// ---------------------------------------------------------------------------
// OBV — cumulative volume by close direction
// ---------------------------------------------------------------------------

export const computeOBV: ComputeFn = (candles) => {
	const n = candles.length;
	const out = filled(n);
	if (n === 0) return out;
	let obv = 0;
	out[0] = 0;
	for (let i = 1; i < n; i++) {
		const diff = candles[i].c - candles[i - 1].c;
		if (diff > 0) obv += candles[i].v;
		else if (diff < 0) obv -= candles[i].v;
		out[i] = obv;
	}
	return out;
};

// ---------------------------------------------------------------------------
// ROC — percentage change over period
// ---------------------------------------------------------------------------

export const computeROC: ComputeFn = (candles, params, src) => {
	const period = Math.max(1, params.int('period', 12));
	const price = priceSeries(candles, src);
	const n = price.length;
	const out = filled(n);
	for (let i = period; i < n; i++) {
		const past = price[i - period];
		out[i] = past === 0 ? NaN : ((price[i] - past) / past) * 100;
	}
	return out;
};

// ---------------------------------------------------------------------------
// CCI — typical price deviation (uses H/L/C only)
// ---------------------------------------------------------------------------

export const computeCCI: ComputeFn = (candles, params) => {
	const period = Math.max(2, params.int('period', 20));
	const n = candles.length;
	const tp = new Array<number>(n);
	for (let i = 0; i < n; i++) tp[i] = (candles[i].h + candles[i].l + candles[i].c) / 3;
	const tpSma = sma(tp, period);
	const out = filled(n);
	for (let i = period - 1; i < n; i++) {
		const mean = tpSma[i];
		if (Number.isNaN(mean)) continue;
		let meanDev = 0;
		for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(tp[j] - mean);
		meanDev /= period;
		out[i] = meanDev === 0 ? 0 : (tp[i] - mean) / (0.015 * meanDev);
	}
	return out;
};

// ---------------------------------------------------------------------------
// Donchian channels — uses H/L only
// ---------------------------------------------------------------------------

export const computeDonchian: ComputeFn = (candles, params) => {
	const period = Math.max(1, params.int('period', 20));
	const highs = candles.map((c) => c.h);
	const lows = candles.map((c) => c.l);
	const upper = rollingHighest(highs, period);
	const lower = rollingLowest(lows, period);
	const n = candles.length;
	const middle = filled(n);
	for (let i = 0; i < n; i++) {
		if (!Number.isNaN(upper[i]) && !Number.isNaN(lower[i])) {
			middle[i] = (upper[i] + lower[i]) / 2;
		}
	}
	return { upper, middle, lower };
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * SMA over a series that may contain a leading NaN warm-up region. Averages the
 * most recent `period` non-NaN values; NaN until that many exist.
 */
function smaIgnoringWarmup(values: number[], period: number): number[] {
	const n = values.length;
	const out = filled(n);
	for (let i = 0; i < n; i++) {
		let count = 0;
		let sum = 0;
		for (let j = i; j >= 0 && count < period; j--) {
			if (Number.isNaN(values[j])) continue;
			sum += values[j];
			count++;
		}
		if (count === period) out[i] = sum / period;
	}
	return out;
}
