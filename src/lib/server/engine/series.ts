/**
 * Series helpers shared by the indicator implementations and the engine.
 *
 * Everything here is point-in-time correct: a value at index `i` depends only on
 * inputs at indices `<= i`. Warm-up positions are filled with `NaN` so callers
 * can treat "not enough data yet" uniformly. These are pure functions with no
 * I/O — server-only by placement, but trivially testable.
 */

import type { Candle, PriceField } from '$lib/types';

/**
 * Project a candle series onto a single numeric series for the given price
 * field. Synthetic fields (hl2/hlc3/ohlc4) are derived per bar.
 */
export function priceSeries(candles: Candle[], field: PriceField): number[] {
	const out = new Array<number>(candles.length);
	for (let i = 0; i < candles.length; i++) {
		out[i] = priceAt(candles[i], field);
	}
	return out;
}

/** Single price field for one candle. */
export function priceAt(candle: Candle, field: PriceField): number {
	switch (field) {
		case 'open':
			return candle.o;
		case 'high':
			return candle.h;
		case 'low':
			return candle.l;
		case 'close':
			return candle.c;
		case 'volume':
			return candle.v;
		case 'hl2':
			return (candle.h + candle.l) / 2;
		case 'hlc3':
			return (candle.h + candle.l + candle.c) / 3;
		case 'ohlc4':
			return (candle.o + candle.h + candle.l + candle.c) / 4;
	}
}

/** Simple moving average over `period`. NaN until `period` samples exist. */
export function sma(values: number[], period: number): number[] {
	const n = values.length;
	const out = new Array<number>(n).fill(NaN);
	if (period < 1) return out;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		sum += values[i];
		if (i >= period) sum -= values[i - period];
		if (i >= period - 1) out[i] = sum / period;
	}
	return out;
}

/**
 * Exponential moving average with smoothing `2/(period+1)`. Seeded with the SMA
 * of the first `period` values so the EMA is deterministic and stable; NaN until
 * the seed is available.
 */
export function ema(values: number[], period: number): number[] {
	const n = values.length;
	const out = new Array<number>(n).fill(NaN);
	if (period < 1 || n === 0) return out;
	const k = 2 / (period + 1);
	let seedSum = 0;
	let prev = NaN;
	for (let i = 0; i < n; i++) {
		if (i < period - 1) {
			seedSum += values[i];
			continue;
		}
		if (i === period - 1) {
			seedSum += values[i];
			prev = seedSum / period;
			out[i] = prev;
			continue;
		}
		prev = values[i] * k + prev * (1 - k);
		out[i] = prev;
	}
	return out;
}

/**
 * Wilder's smoothing (used by RSI/ATR/ADX): like an EMA with alpha = 1/period,
 * seeded with the simple average of the first `period` samples.
 */
export function wilderSmooth(values: number[], period: number): number[] {
	const n = values.length;
	const out = new Array<number>(n).fill(NaN);
	if (period < 1 || n === 0) return out;
	let seedSum = 0;
	let prev = NaN;
	for (let i = 0; i < n; i++) {
		const v = values[i];
		if (Number.isNaN(v)) {
			out[i] = NaN;
			continue;
		}
		if (i < period - 1) {
			seedSum += v;
			continue;
		}
		if (i === period - 1) {
			seedSum += v;
			prev = seedSum / period;
			out[i] = prev;
			continue;
		}
		prev = (prev * (period - 1) + v) / period;
		out[i] = prev;
	}
	return out;
}

/** Linearly-weighted moving average (weights 1..period, newest heaviest). */
export function wma(values: number[], period: number): number[] {
	const n = values.length;
	const out = new Array<number>(n).fill(NaN);
	if (period < 1) return out;
	const denom = (period * (period + 1)) / 2;
	for (let i = period - 1; i < n; i++) {
		let weighted = 0;
		for (let j = 0; j < period; j++) {
			// weight grows toward the most recent sample (j = period-1)
			weighted += values[i - (period - 1) + j] * (j + 1);
		}
		out[i] = weighted / denom;
	}
	return out;
}

/**
 * Rolling population standard deviation over `period`. Uses the same window as
 * the SMA so it pairs with Bollinger bands. NaN during warm-up.
 */
export function rollingStdDev(values: number[], period: number, means: number[]): number[] {
	const n = values.length;
	const out = new Array<number>(n).fill(NaN);
	if (period < 1) return out;
	for (let i = period - 1; i < n; i++) {
		const mean = means[i];
		if (Number.isNaN(mean)) continue;
		let acc = 0;
		for (let j = i - period + 1; j <= i; j++) {
			const d = values[j] - mean;
			acc += d * d;
		}
		out[i] = Math.sqrt(acc / period);
	}
	return out;
}

/** True range per bar. trueRange[0] = high-low (no previous close). */
export function trueRange(candles: Candle[]): number[] {
	const n = candles.length;
	const out = new Array<number>(n).fill(NaN);
	for (let i = 0; i < n; i++) {
		const c = candles[i];
		if (i === 0) {
			out[i] = c.h - c.l;
			continue;
		}
		const prevClose = candles[i - 1].c;
		out[i] = Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
	}
	return out;
}

/** Highest value over a trailing window of `period` (inclusive). */
export function rollingHighest(values: number[], period: number): number[] {
	const n = values.length;
	const out = new Array<number>(n).fill(NaN);
	for (let i = period - 1; i < n; i++) {
		let hi = -Infinity;
		for (let j = i - period + 1; j <= i; j++) if (values[j] > hi) hi = values[j];
		out[i] = hi;
	}
	return out;
}

/** Lowest value over a trailing window of `period` (inclusive). */
export function rollingLowest(values: number[], period: number): number[] {
	const n = values.length;
	const out = new Array<number>(n).fill(NaN);
	for (let i = period - 1; i < n; i++) {
		let lo = Infinity;
		for (let j = i - period + 1; j <= i; j++) if (values[j] < lo) lo = values[j];
		out[i] = lo;
	}
	return out;
}
