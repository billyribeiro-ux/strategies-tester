/**
 * Pure, leak-free time-frame resampling: daily -> monthly / weekly.
 *
 * LEAK-FREENESS
 * -------------
 * Each aggregated bar is stamped at the timestamp of the LAST daily bar present
 * in that calendar bucket. The bar's OHLCV summarizes only days that fall within
 * the bucket — never future buckets — so no future information bleeds backwards.
 *
 * A subtlety: the final bucket in a data set may be PARTIAL (e.g. data ends
 * mid-month). We cannot reliably detect "the month has closed" from candles
 * alone (a trading holiday vs. end-of-data look identical), so we still emit one
 * bar per bucket present, stamped at that bucket's last available day. The
 * CONTRACT for consumers is therefore: only act on a resampled bar AFTER its
 * bucket has closed. The engine already evaluates strictly on closed bars, so a
 * partial trailing bar is simply never traded — there is no leak in practice.
 *
 * Grouping is by UTC calendar fields so it is deterministic and timezone-stable
 * (daily candles are anchored at UTC midnight by the FMP client). Weekly uses
 * ISO weeks, matching the existing `aggregateWeekly` in the FMP client.
 */

import type { Candle } from '$lib/types';

/** Aggregate the days currently in `cur` are folded into a running bar. */
function fold(cur: Candle, day: Candle): void {
	cur.h = Math.max(cur.h, day.h);
	cur.l = Math.min(cur.l, day.l);
	cur.c = day.c; // last close wins
	cur.v += day.v;
	cur.t = day.t; // stamp at the latest day seen in the bucket
}

/**
 * Generic bucketing: ascending daily candles -> ascending aggregated bars, one
 * per distinct `keyOf` bucket. o=first open, h=max high, l=min low, c=last
 * close, v=sum volume, t=last day's timestamp in the bucket.
 */
function resampleBy(daily: Candle[], keyOf: (iso: string) => string): Candle[] {
	// Defensive: never assume input order; sort ascending by instant.
	const sorted = [...daily].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
	const out: Candle[] = [];
	let bucketKey = '';
	let cur: Candle | null = null;
	for (const day of sorted) {
		const ms = Date.parse(day.t);
		if (Number.isNaN(ms)) continue; // skip unparseable timestamps
		const key = keyOf(day.t);
		if (key !== bucketKey) {
			if (cur) out.push(cur);
			bucketKey = key;
			cur = { t: day.t, o: day.o, h: day.h, l: day.l, c: day.c, v: day.v };
		} else if (cur) {
			fold(cur, day);
		}
	}
	if (cur) out.push(cur);
	return out;
}

/** UTC year-month bucket key, e.g. `2024-03`. */
function monthKey(iso: string): string {
	const d = new Date(iso);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * ISO year-week key, e.g. `2024-W09`. Matches the FMP client's `aggregateWeekly`
 * so weekly bars bucket identically across the codebase, including year ends.
 */
function isoWeekKey(iso: string): string {
	const src = new Date(iso);
	const date = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()));
	const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
	date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
	const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	const week =
		1 +
		Math.round(
			((date.getTime() - firstThursday.getTime()) / 86_400_000 -
				3 +
				((firstThursday.getUTCDay() + 6) % 7)) /
				7
		);
	return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Resample ascending daily candles into monthly bars, grouped by UTC calendar
 * month. See the module header for the leak-free contract on partial trailing
 * months. Returns ascending bars; empty input yields an empty array.
 */
export function resampleToMonthly(daily: Candle[]): Candle[] {
	return resampleBy(daily, monthKey);
}

/**
 * Resample ascending daily candles into ISO-week bars (Mon-anchored), grouped by
 * ISO year+week. Returns ascending bars; empty input yields an empty array.
 */
export function resampleToWeekly(daily: Candle[]): Candle[] {
	return resampleBy(daily, isoWeekKey);
}
