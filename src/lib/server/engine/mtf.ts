/**
 * Multi-timeframe (MTF) resampling + no-leak alignment — PURE helpers (spec §3 / §4a).
 *
 * These power "compute an indicator on a HIGHER timeframe than the universe, then
 * read it on the base bars". The hard requirement is LEAK-FREENESS: a higher-TF
 * (HTF) bar's value may only become visible at a base bar AFTER that HTF bar has
 * CLOSED. Anything else would let the engine peek at a bar that is still forming.
 *
 * Two steps:
 *   1. `resampleBySeconds` — fold base candles into fixed HTF buckets (by epoch
 *      seconds), recording the CLOSE TIME of each bucket (the timestamp of its
 *      last base bar — the moment that HTF bar is known to have finished).
 *   2. `alignToBase` — project an HTF series back onto base-bar indices: at base
 *      time `t`, expose the value of the most recent HTF bucket that has already
 *      CLOSED (bucketEndMs ≤ t); NaN before the first close. This is the no-leak
 *      step. The result is indexed 1:1 with the base bars, so the rest of the
 *      engine (which reads indicator series by BASE index) needs no changes.
 *
 * Unlike the calendar resamplers in `universe/resample.ts` (which bucket by UTC
 * month/ISO-week), this buckets by a fixed number of seconds — the natural unit
 * for intraday → higher-intraday resampling, and the `seconds` field the
 * capabilities catalog already carries for every timeframe.
 */

import type { Candle } from '$lib/types';

/** A resampled higher-timeframe series plus each bucket's CLOSE time. */
export interface ResampledSeries {
	/** Aggregated HTF bars, ascending by time. */
	bars: Candle[];
	/**
	 * `bucketEndMs[k]` = the close time of `bars[k]`, in epoch ms = the timestamp
	 * of the LAST base bar folded into that bucket. The HTF bar is only known to
	 * exist (have closed) at this instant — never before. Same length as `bars`.
	 */
	bucketEndMs: number[];
}

/**
 * Group ascending base candles into fixed higher-timeframe buckets of
 * `bucketSeconds` each, keyed by `floor(epochMs / (bucketSeconds*1000))`.
 *
 * Each HTF bar aggregates the base bars in its bucket: o = first open,
 * h = max high, l = min low, c = last close, v = sum volume. Its timestamp `t`
 * (and `bucketEndMs`) is the LAST base bar's timestamp in the bucket — the moment
 * the HTF bar has closed (point-in-time). Buckets are emitted ascending; an empty
 * or all-unparseable input yields empty arrays. `bucketSeconds ≤ 0` is treated as
 * a no-op grouping (one bucket per base bar) to avoid divide-by-zero — callers
 * never pass that, but it keeps the helper total.
 *
 * Defensive: input is sorted ascending by instant before bucketing, so unordered
 * candles still produce a well-formed, deterministic result.
 */
export function resampleBySeconds(base: Candle[], bucketSeconds: number): ResampledSeries {
	const bars: Candle[] = [];
	const bucketEndMs: number[] = [];
	const bucketMs = bucketSeconds > 0 ? bucketSeconds * 1000 : 1;

	// Never assume input order; sort ascending by instant (mirrors resample.ts).
	const sorted = [...base]
		.map((c) => ({ c, ms: Date.parse(c.t) }))
		.filter((x) => !Number.isNaN(x.ms))
		.sort((a, b) => a.ms - b.ms);

	let curKey: number | null = null;
	let cur: Candle | null = null;
	for (const { c, ms } of sorted) {
		const key = Math.floor(ms / bucketMs);
		if (key !== curKey) {
			if (cur) {
				bars.push(cur);
				bucketEndMs.push(Date.parse(cur.t));
			}
			curKey = key;
			cur = { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
		} else if (cur) {
			cur.h = Math.max(cur.h, c.h);
			cur.l = Math.min(cur.l, c.l);
			cur.c = c.c; // last close wins
			cur.v += c.v;
			cur.t = c.t; // stamp at the latest base bar seen in the bucket
		}
	}
	if (cur) {
		bars.push(cur);
		bucketEndMs.push(Date.parse(cur.t));
	}

	return { bars, bucketEndMs };
}

/**
 * Project a higher-timeframe value series back onto base-bar indices WITHOUT
 * look-ahead.
 *
 * For each base bar time `t` (in `baseTimesMs`), return the `htfValues` entry of
 * the most recent HTF bucket whose close time `bucketEndMs ≤ t` — i.e. the latest
 * bucket that has ALREADY CLOSED at `t`. Before the first bucket closes the result
 * is `NaN`. The returned series is indexed 1:1 with the base bars.
 *
 * THIS is the no-leak step: by gating on `bucketEndMs ≤ t` (closed, not forming),
 * a base bar can never read a higher-TF bar that finishes in its own future. The
 * `≤` (not `<`) is correct because the bucket's close time IS a base bar's time:
 * at that exact base bar the HTF bar has just closed and is legitimately known.
 *
 * `htfValues` and `bucketEndMs` must be the same length and ascending in time
 * (as produced by `resampleBySeconds` + a compute fn). `baseTimesMs` need not be
 * sorted; each entry is resolved independently via binary search.
 */
export function alignToBase(
	baseTimesMs: number[],
	htfValues: number[],
	bucketEndMs: number[]
): number[] {
	const out = new Array<number>(baseTimesMs.length).fill(NaN);
	const n = bucketEndMs.length;
	if (n === 0) return out;

	for (let i = 0; i < baseTimesMs.length; i++) {
		const t = baseTimesMs[i];
		// Largest k with bucketEndMs[k] <= t (the latest already-closed bucket).
		let lo = 0;
		let hi = n - 1;
		let k = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (bucketEndMs[mid] <= t) {
				k = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (k >= 0) {
			const v = htfValues[k];
			out[i] = typeof v === 'number' ? v : NaN;
		}
	}
	return out;
}
