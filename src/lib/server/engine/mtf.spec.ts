import { describe, it, expect } from 'vitest';
import type { Candle } from '$lib/types';
import { alignToBase, resampleBySeconds } from './mtf';

// ---------------------------------------------------------------------------
// Fixtures: hourly base candles, so we can resample to a higher (4h) TF.
// ---------------------------------------------------------------------------

const HOUR = 3600;

/** Build hourly candles from explicit [o,h,l,c,v] tuples, anchored at UTC midnight. */
function hourly(bars: [number, number, number, number, number][]): Candle[] {
	return bars.map(([o, h, l, c, v], i) => ({
		t: new Date(Date.UTC(2024, 0, 1, i)).toISOString(),
		o,
		h,
		l,
		c,
		v
	}));
}

const ms = (iso: string) => Date.parse(iso);

// ---------------------------------------------------------------------------
// resampleBySeconds — aggregation
// ---------------------------------------------------------------------------

describe('resampleBySeconds — aggregation', () => {
	it('folds hourly bars into 4h buckets: first open / max high / min low / last close / sum volume', () => {
		// 8 hourly bars → two 4h buckets (00:00-03:00 and 04:00-07:00).
		const base = hourly([
			[10, 12, 9, 11, 100], // 00:00
			[11, 15, 10, 13, 200], // 01:00
			[13, 14, 8, 9, 150], // 02:00
			[9, 11, 7, 10, 50], // 03:00  ← bucket 0 closes here
			[10, 20, 10, 18, 300], // 04:00
			[18, 22, 16, 19, 100], // 05:00
			[19, 19, 12, 14, 250], // 06:00
			[14, 16, 11, 15, 120] // 07:00  ← bucket 1 closes here
		]);
		const { bars, bucketEndMs } = resampleBySeconds(base, 4 * HOUR);

		expect(bars).toHaveLength(2);

		// Bucket 0: o=first(10), h=max(12,15,14,11)=15, l=min(9,10,8,7)=7,
		//           c=last(10), v=100+200+150+50=500.
		expect(bars[0]).toMatchObject({ o: 10, h: 15, l: 7, c: 10, v: 500 });
		// Stamped + closed at the LAST base bar in the bucket (03:00).
		expect(bars[0].t).toBe(base[3].t);
		expect(bucketEndMs[0]).toBe(ms(base[3].t));

		// Bucket 1: o=10, h=max(20,22,19,16)=22, l=min(10,16,12,11)=10,
		//           c=last(15), v=300+100+250+120=770.
		expect(bars[1]).toMatchObject({ o: 10, h: 22, l: 10, c: 15, v: 770 });
		expect(bars[1].t).toBe(base[7].t);
		expect(bucketEndMs[1]).toBe(ms(base[7].t));
	});

	it('emits one partial trailing bucket when data ends mid-bucket', () => {
		// 6 hourly bars with a 4h bucket: bucket 0 is full (4 bars), bucket 1 is
		// partial (2 bars). Both are emitted, each stamped at its last base bar.
		const base = hourly([
			[1, 2, 1, 2, 10],
			[2, 3, 1, 2, 10],
			[2, 4, 2, 3, 10],
			[3, 3, 2, 2, 10], // 03:00 closes bucket 0
			[2, 5, 2, 4, 10],
			[4, 6, 3, 5, 10] // 05:00 closes (partial) bucket 1
		]);
		const { bars, bucketEndMs } = resampleBySeconds(base, 4 * HOUR);

		expect(bars).toHaveLength(2);
		expect(bucketEndMs[0]).toBe(ms(base[3].t));
		expect(bucketEndMs[1]).toBe(ms(base[5].t)); // partial bucket's last bar
		expect(bars[1].c).toBe(5); // last close of the partial bucket
	});

	it('is order-insensitive: shuffled input yields the same ascending buckets', () => {
		const base = hourly([
			[10, 12, 9, 11, 100],
			[11, 15, 10, 13, 200],
			[13, 14, 8, 9, 150],
			[9, 11, 7, 10, 50]
		]);
		const shuffled = [base[2], base[0], base[3], base[1]];
		const a = resampleBySeconds(base, 4 * HOUR);
		const b = resampleBySeconds(shuffled, 4 * HOUR);
		expect(b.bars).toEqual(a.bars);
		expect(b.bucketEndMs).toEqual(a.bucketEndMs);
	});

	it('returns empty arrays for empty input', () => {
		const { bars, bucketEndMs } = resampleBySeconds([], 4 * HOUR);
		expect(bars).toEqual([]);
		expect(bucketEndMs).toEqual([]);
	});

	it('skips unparseable timestamps', () => {
		const base = hourly([
			[1, 2, 1, 2, 10],
			[2, 3, 1, 2, 10]
		]);
		base[0] = { ...base[0], t: 'not-a-date' };
		const { bars } = resampleBySeconds(base, 4 * HOUR);
		expect(bars).toHaveLength(1);
		expect(bars[0].o).toBe(2); // the only parseable bar
	});
});

// ---------------------------------------------------------------------------
// alignToBase — no-leak boundary
// ---------------------------------------------------------------------------

describe('alignToBase — no-leak boundary', () => {
	// Two HTF buckets closing at 03:00 (value 100) and 07:00 (value 200).
	const bucketEndMs = [
		ms(new Date(Date.UTC(2024, 0, 1, 3)).toISOString()),
		ms(new Date(Date.UTC(2024, 0, 1, 7)).toISOString())
	];
	const htfValues = [100, 200];

	function baseTimes(hours: number[]): number[] {
		return hours.map((h) => ms(new Date(Date.UTC(2024, 0, 1, h)).toISOString()));
	}

	it('is NaN before the first HTF bucket has closed', () => {
		const out = alignToBase(baseTimes([0, 1, 2]), htfValues, bucketEndMs);
		expect(out.every((v) => Number.isNaN(v))).toBe(true);
	});

	it('exposes a bucket value exactly AT its close bar (≤ boundary), never before', () => {
		// 02:00 → not closed yet (NaN); 03:00 → bucket 0 just closed (100).
		const out = alignToBase(baseTimes([2, 3]), htfValues, bucketEndMs);
		expect(Number.isNaN(out[0])).toBe(true); // forming → hidden
		expect(out[1]).toBe(100); // closed at this exact bar → visible
	});

	it('holds the most recent CLOSED bucket between closes (no forming-bar leak)', () => {
		// 04:00, 05:00, 06:00 are inside the SECOND bucket which has not closed yet,
		// so they must still read the FIRST (completed) bucket's value (100), never 200.
		const out = alignToBase(baseTimes([3, 4, 5, 6, 7]), htfValues, bucketEndMs);
		expect(out).toEqual([100, 100, 100, 100, 200]);
		// The forming second bucket (04:00-06:00) NEVER exposes its own value early.
		expect(out.slice(1, 4).includes(200)).toBe(false);
	});

	it('resolves each base time independently of input order', () => {
		const out = alignToBase(baseTimes([7, 2, 3, 5]), htfValues, bucketEndMs);
		expect(out).toEqual([200, NaN, 100, 100]);
	});

	it('returns all-NaN when there are no HTF buckets', () => {
		const out = alignToBase(baseTimes([0, 1, 2]), [], []);
		expect(out.every((v) => Number.isNaN(v))).toBe(true);
	});

	it('propagates NaN HTF values (warm-up) to the aligned series', () => {
		const out = alignToBase(baseTimes([3, 7]), [NaN, 200], bucketEndMs);
		expect(Number.isNaN(out[0])).toBe(true); // first bucket still warming up
		expect(out[1]).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// End-to-end: resample then align is leak-free by construction
// ---------------------------------------------------------------------------

describe('resampleBySeconds + alignToBase — combined no-leak', () => {
	it('a base bar only ever sees the previous COMPLETED HTF close', () => {
		const base = hourly([
			[10, 10, 10, 10, 1], // 00
			[10, 11, 10, 11, 1], // 01
			[11, 12, 11, 12, 1], // 02
			[12, 13, 12, 13, 1], // 03 ← bucket 0 closes, close=13
			[13, 14, 13, 14, 1], // 04
			[14, 15, 14, 15, 1], // 05
			[15, 16, 15, 16, 1], // 06
			[16, 17, 16, 17, 1] // 07 ← bucket 1 closes, close=17
		]);
		const { bars, bucketEndMs } = resampleBySeconds(base, 4 * HOUR);
		const htfClose = bars.map((b) => b.c); // [13, 17]
		const aligned = alignToBase(
			base.map((c) => Date.parse(c.t)),
			htfClose,
			bucketEndMs
		);
		// Bars 0-2: bucket 0 not closed → NaN. Bar 3: bucket 0 closed → 13.
		// Bars 4-6: bucket 1 forming → still 13. Bar 7: bucket 1 closed → 17.
		expect(aligned.map((v) => (Number.isNaN(v) ? 'NaN' : v))).toEqual([
			'NaN',
			'NaN',
			'NaN',
			13,
			13,
			13,
			13,
			17
		]);
	});
});
