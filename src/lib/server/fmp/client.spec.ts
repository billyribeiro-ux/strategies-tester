import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAdjustment, fetchCandles, type FetchFn } from './client';
import { FMP_KEY, getSetting, setSetting, deleteSetting } from '../db/repository';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
//
// `fetchCandles` is cache-first against the real (local) SQLite candle_cache and
// resolves the FMP key from the DB/env. We therefore:
//   - inject the key once via the repository (no network is ever touched — the
//     stub FetchFn returns canned JSON), and
//   - use a UNIQUE symbol per test (cache key = symbol+timeframe+from+to) so a
//     persisted cache row from a prior run can never satisfy or pollute a test.

const FROM = '2024-01-01';
const TO = '2024-03-31';

/** Unique symbol per call so cache rows never collide across runs. */
let seq = 0;
function uniqueSymbol(tag: string): string {
	seq += 1;
	return `TST_${tag}_${Date.now().toString(36)}_${seq}`;
}

/** A raw daily FMP bar (no adjustment fields). */
function rawBar(date: string, o: number, h: number, l: number, c: number, v: number) {
	return { date, open: o, high: h, low: l, close: c, volume: v };
}

/** Stub fetch that serves a canned daily payload regardless of URL. */
function stubDaily(bars: unknown[]): FetchFn {
	return (async () =>
		({ ok: true, status: 200, json: async () => bars }) as unknown as Response) as FetchFn;
}

let priorKey: string | null = null;

beforeAll(() => {
	priorKey = getSetting(FMP_KEY);
	setSetting(FMP_KEY, 'test-key');
});

afterAll(() => {
	if (priorKey === null) deleteSetting(FMP_KEY);
	else setSetting(FMP_KEY, priorKey);
});

// ---------------------------------------------------------------------------
// applyAdjustment (pure)
// ---------------------------------------------------------------------------

describe('applyAdjustment', () => {
	it('prefers full adjusted OHLC when present', () => {
		const out = applyAdjustment({
			date: '2024-01-02',
			open: 100,
			high: 110,
			low: 90,
			close: 105,
			adjOpen: 50,
			adjHigh: 55,
			adjLow: 45,
			adjClose: 52.5
		});
		expect(out).toEqual({ o: 50, h: 55, l: 45, c: 52.5 });
	});

	it('scales raw OHLC by adjClose/close when only adjClose is present (2:1 split)', () => {
		// Pre-split bar after a 2:1 split: adjClose is half of raw close.
		const out = applyAdjustment({
			date: '2024-01-02',
			open: 100,
			high: 120,
			low: 80,
			close: 100,
			adjClose: 50
		});
		// factor = 50 / 100 = 0.5 applied to every leg; close pinned to adjClose.
		expect(out).toEqual({ o: 50, h: 60, l: 40, c: 50 });
	});

	it('falls back to raw OHLC when no adjustment fields are present', () => {
		const out = applyAdjustment({ date: '2024-01-02', open: 10, high: 12, low: 9, close: 11 });
		expect(out).toEqual({ o: 10, h: 12, l: 9, c: 11 });
	});

	it('returns null when raw OHLC is not fully numeric', () => {
		expect(applyAdjustment({ date: '2024-01-02', open: 10, high: 12, low: 9 })).toBeNull();
	});

	it('does not scale when close is zero (avoids divide-by-zero)', () => {
		const out = applyAdjustment({
			date: '2024-01-02',
			open: 1,
			high: 2,
			low: 0,
			close: 0,
			adjClose: 5
		});
		expect(out).toEqual({ o: 1, h: 2, l: 0, c: 0 });
	});
});

// ---------------------------------------------------------------------------
// fetchCandles — '1month' aggregation
// ---------------------------------------------------------------------------

describe("fetchCandles('1month')", () => {
	// Jan: 2 days, Feb: 3 days, Mar: 2 days. Raw bars (no adj fields).
	const daily = [
		rawBar('2024-01-05', 10, 12, 9, 11, 100),
		rawBar('2024-01-20', 11, 15, 8, 13, 200),
		rawBar('2024-02-02', 13, 14, 7, 9, 50),
		rawBar('2024-02-10', 9, 20, 6, 18, 80),
		rawBar('2024-02-28', 18, 19, 17, 17, 70),
		rawBar('2024-03-01', 17, 25, 16, 22, 300),
		rawBar('2024-03-15', 22, 23, 21, 21, 10)
	];

	it('returns one bar per completed month with correct OHLCV, ascending', async () => {
		const out = await fetchCandles(
			{ symbol: uniqueSymbol('MONTH'), timeframe: '1month', from: FROM, to: TO },
			stubDaily(daily)
		);
		expect(out).toHaveLength(3);

		const [jan, feb, mar] = out;
		// first open, max high, min low, last close, summed volume
		expect(jan).toMatchObject({ o: 10, h: 15, l: 8, c: 13, v: 300 });
		expect(feb).toMatchObject({ o: 13, h: 20, l: 6, c: 17, v: 200 });
		expect(mar).toMatchObject({ o: 17, h: 25, l: 16, c: 21, v: 310 });

		// stamped at each month's last available day (leak-free contract)
		expect(jan.t).toBe('2024-01-20T00:00:00.000Z');
		expect(feb.t).toBe('2024-02-28T00:00:00.000Z');
		expect(mar.t).toBe('2024-03-15T00:00:00.000Z');

		// ascending
		for (let i = 1; i < out.length; i++) {
			expect(Date.parse(out[i].t)).toBeGreaterThan(Date.parse(out[i - 1].t));
		}
	});

	it('hits the dividend-adjusted EOD endpoint', async () => {
		const seen: string[] = [];
		const spy: FetchFn = (async (input: RequestInfo | URL) => {
			seen.push(String(input));
			return { ok: true, status: 200, json: async () => daily } as unknown as Response;
		}) as FetchFn;
		await fetchCandles(
			{ symbol: uniqueSymbol('ENDPOINT'), timeframe: '1month', from: FROM, to: TO },
			spy
		);
		expect(seen.some((u) => u.includes('/historical-price-eod/dividend-adjusted'))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// fetchCandles — corporate-action adjustment end-to-end
// ---------------------------------------------------------------------------

describe('fetchCandles corporate-action adjustment', () => {
	it('uses full adjusted OHLC fields when the payload provides them', async () => {
		const bars = [
			{
				date: '2024-01-05',
				open: 200,
				high: 220,
				low: 180,
				close: 210,
				adjOpen: 100,
				adjHigh: 110,
				adjLow: 90,
				adjClose: 105,
				volume: 1000
			}
		];
		const out = await fetchCandles(
			{ symbol: uniqueSymbol('ADJFULL'), timeframe: '1d', from: FROM, to: TO },
			stubDaily(bars)
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ o: 100, h: 110, l: 90, c: 105, v: 1000 });
	});

	it('applies a 2:1 split via adjClose/close scaling when only adjClose is present', async () => {
		const bars = [
			// Pre-split day: raw close 100, adjClose 50 -> factor 0.5 on every leg.
			{ date: '2024-01-05', open: 100, high: 120, low: 80, close: 100, adjClose: 50, volume: 500 }
		];
		const out = await fetchCandles(
			{ symbol: uniqueSymbol('ADJSCALE'), timeframe: '1d', from: FROM, to: TO },
			stubDaily(bars)
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ o: 50, h: 60, l: 40, c: 50, v: 500 });
	});

	it('falls back to raw OHLC when no adjustment fields exist', async () => {
		const bars = [rawBar('2024-01-05', 10, 12, 9, 11, 100)];
		const out = await fetchCandles(
			{ symbol: uniqueSymbol('RAW'), timeframe: '1d', from: FROM, to: TO },
			stubDaily(bars)
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ o: 10, h: 12, l: 9, c: 11, v: 100 });
	});
});
