import { describe, it, expect } from 'vitest';
import type { Candle } from '$lib/types';
import { ExplicitListProvider } from './explicit';
import { FmpPitProvider } from './fmp-pit';
import { resampleToMonthly, resampleToWeekly } from './resample';
import type { FetchFn } from './types';

// ---------------------------------------------------------------------------
// Helpers / fixtures (deterministic — no Date.now / Math.random)
// ---------------------------------------------------------------------------

/** Build a daily candle anchored at UTC midnight (matches FMP client output). */
function day(ymd: string, o: number, h: number, l: number, c: number, v: number): Candle {
	return { t: `${ymd}T00:00:00.000Z`, o, h, l, c, v };
}

/**
 * A stub fetch that serves canned JSON per matched URL substring. Routes are
 * tested in order, so list more-specific matches (e.g. `historical-...`) first.
 */
function stubFetch(routes: Array<{ match: string; body: unknown; status?: number }>): FetchFn {
	return (async (input: RequestInfo | URL): Promise<Response> => {
		const url = String(input);
		for (const r of routes) {
			if (url.includes(r.match)) {
				const status = r.status ?? 200;
				return {
					ok: status >= 200 && status < 300,
					status,
					json: async () => r.body
				} as unknown as Response;
			}
		}
		// Unmatched -> empty array (valid but empty).
		return { ok: true, status: 200, json: async () => [] } as unknown as Response;
	}) as FetchFn;
}

// ---------------------------------------------------------------------------
// ExplicitListProvider
// ---------------------------------------------------------------------------

describe('ExplicitListProvider', () => {
	it('returns the (normalized) symbols for any date', async () => {
		const p = new ExplicitListProvider(['aapl', 'MSFT', ' tsla ']);
		const a = await p.membersAt('1990-01-01');
		const b = await p.membersAt('2030-12-31');
		expect(a).toEqual(['AAPL', 'MSFT', 'TSLA']);
		expect(b).toEqual(['AAPL', 'MSFT', 'TSLA']);
	});

	it('de-duplicates and sorts symbols', async () => {
		const p = new ExplicitListProvider(['MSFT', 'aapl', 'AAPL', 'msft', '']);
		expect(await p.membersAt('2020-06-01')).toEqual(['AAPL', 'MSFT']);
	});

	it('resolve emits a single membership covering the range plus a survivorship gap', async () => {
		const p = new ExplicitListProvider(['SPY', 'QQQ']);
		const { membership, gaps } = await p.resolve('2020-01-01', '2021-01-01');
		expect(membership).toHaveLength(1);
		expect(membership[0].date).toBe('2020-01-01');
		expect(membership[0].symbols).toEqual(['QQQ', 'SPY']);
		expect(gaps).toHaveLength(1);
		expect(gaps[0].detail.toLowerCase()).toContain('survivorship');
	});

	it('exposes a stable id and ignores the injected fetchFn (pure)', async () => {
		let called = 0;
		const fetchFn = (async () => {
			called++;
			return { ok: true, status: 200, json: async () => [] } as unknown as Response;
		}) as FetchFn;
		const p = new ExplicitListProvider(['AAPL']);
		expect(p.id).toBe('explicit');
		await p.membersAt('2020-01-01', fetchFn);
		await p.resolve('2020-01-01', '2021-01-01', fetchFn);
		expect(called).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// FmpPitProvider
// ---------------------------------------------------------------------------

describe('FmpPitProvider', () => {
	it('reconstructs PIT members and includes a delisted name active in the window', async () => {
		// Current members: AAA, BBB. History: DDD was removed 2021-06-01 (so it was
		// a member before then); CCC was added 2022-01-01 (not a member before).
		const fetchFn = stubFetch([
			{
				match: '/sp500-constituent?',
				body: [{ symbol: 'AAA' }, { symbol: 'BBB' }, { symbol: 'CCC' }]
			},
			{
				match: 'historical-sp500-constituent',
				body: [
					{ date: '2022-01-01', addedSecurity: 'CCC', removedTicker: 'DDD' },
					{ date: '2021-06-01', addedSecurity: 'EEE', removedTicker: 'FFF' }
				]
			},
			{
				match: 'delisted-companies',
				body: [
					{ symbol: 'DDD', delistedDate: '2022-03-15' },
					{ symbol: 'OLD', delistedDate: '2010-01-01' } // outside window
				]
			}
		]);
		const p = new FmpPitProvider({ apiKey: 'k' });
		const { membership, gaps } = await p.resolve('2021-12-01', '2022-06-30', fetchFn);

		expect(p.id).toBe('fmp-pit:sp500');
		expect(membership.length).toBeGreaterThan(0);
		// Ascending by date.
		for (let i = 1; i < membership.length; i++) {
			expect(membership[i].date >= membership[i - 1].date).toBe(true);
		}
		// Delisted-in-window name DDD must appear somewhere in the universe.
		const all = new Set(membership.flatMap((m) => m.symbols));
		expect(all.has('DDD')).toBe(true);
		// Out-of-window delisting OLD must NOT appear.
		expect(all.has('OLD')).toBe(false);
		expect(gaps).toEqual([]);
	});

	it('membersAt reflects backward replay: a name added later is absent before its add date', async () => {
		const fetchFn = stubFetch([
			{ match: '/sp500-constituent?', body: [{ symbol: 'AAA' }, { symbol: 'CCC' }] },
			{
				match: 'historical-sp500-constituent',
				body: [{ date: '2022-01-01', addedSecurity: 'CCC', removedTicker: 'DDD' }]
			},
			{ match: 'delisted-companies', body: [] }
		]);
		const p = new FmpPitProvider({ apiKey: 'k' });
		// Before the add date, CCC should not be a member but DDD should be.
		const before = await p.membersAt('2021-12-31', fetchFn);
		expect(before).toContain('AAA');
		expect(before).toContain('DDD');
		expect(before).not.toContain('CCC');
		// After the add date, CCC is a member and DDD is gone.
		const after = await p.membersAt('2022-06-01', fetchFn);
		expect(after).toContain('CCC');
		expect(after).not.toContain('DDD');
	});

	it('emits a coverage gap when the historical change feed is empty', async () => {
		const fetchFn = stubFetch([
			{ match: '/sp500-constituent?', body: [{ symbol: 'AAA' }] },
			{ match: 'historical-sp500-constituent', body: [] },
			{ match: 'delisted-companies', body: [] }
		]);
		const p = new FmpPitProvider({ apiKey: 'k' });
		const { gaps } = await p.resolve('2020-01-01', '2021-01-01', fetchFn);
		expect(gaps.some((g) => g.detail.toLowerCase().includes('change'))).toBe(true);
	});

	it('emits a coverage gap and does not throw on an HTTP error response', async () => {
		const fetchFn = stubFetch([
			{ match: '/sp500-constituent?', body: { 'Error Message': 'nope' }, status: 403 },
			{ match: 'historical-sp500-constituent', body: [], status: 500 },
			{ match: 'delisted-companies', body: [], status: 500 }
		]);
		const p = new FmpPitProvider({ apiKey: 'k' });
		const { membership, gaps } = await p.resolve('2020-01-01', '2021-01-01', fetchFn);
		expect(gaps.length).toBeGreaterThan(0);
		expect(gaps.some((g) => g.detail.includes('HTTP 403'))).toBe(true);
		// Best-effort: still returns membership rows (possibly empty), never throws.
		expect(Array.isArray(membership)).toBe(true);
	});

	it('emits a gap when fetch rejects (network failure), without throwing', async () => {
		const fetchFn = (async () => {
			throw new Error('boom');
		}) as FetchFn;
		const p = new FmpPitProvider({ apiKey: 'k' });
		const { gaps } = await p.resolve('2020-01-01', '2021-01-01', fetchFn);
		expect(gaps.some((g) => g.detail.toLowerCase().includes('could not reach'))).toBe(true);
	});

	it('handles a non-array / unexpected JSON shape via a gap', async () => {
		const fetchFn = stubFetch([
			{ match: '/sp500-constituent?', body: { weird: true } },
			{ match: 'historical-sp500-constituent', body: { weird: true } },
			{ match: 'delisted-companies', body: { weird: true } }
		]);
		const p = new FmpPitProvider({ apiKey: 'k' });
		const { gaps } = await p.resolve('2020-01-01', '2021-01-01', fetchFn);
		expect(gaps.some((g) => g.detail.toLowerCase().includes('unexpected shape'))).toBe(true);
	});

	it('templates endpoint paths from the index option', async () => {
		const seen: string[] = [];
		const fetchFn = (async (input: RequestInfo | URL) => {
			seen.push(String(input));
			return { ok: true, status: 200, json: async () => [] } as unknown as Response;
		}) as FetchFn;
		const p = new FmpPitProvider({ apiKey: 'k', index: 'nasdaq100' });
		expect(p.id).toBe('fmp-pit:nasdaq100');
		await p.resolve('2020-01-01', '2021-01-01', fetchFn);
		expect(seen.some((u) => u.includes('/nasdaq100-constituent?'))).toBe(true);
		expect(seen.some((u) => u.includes('/historical-nasdaq100-constituent'))).toBe(true);
		expect(seen.some((u) => u.includes('/delisted-companies'))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// resampleToMonthly
// ---------------------------------------------------------------------------

describe('resampleToMonthly', () => {
	// Jan: 2 days, Feb: 3 days, Mar: 2 days.
	const daily: Candle[] = [
		day('2024-01-05', 10, 12, 9, 11, 100),
		day('2024-01-20', 11, 15, 8, 13, 200),
		day('2024-02-02', 13, 14, 7, 9, 50),
		day('2024-02-10', 9, 20, 6, 18, 80),
		day('2024-02-28', 18, 19, 17, 17, 70),
		day('2024-03-01', 17, 25, 16, 22, 300),
		day('2024-03-15', 22, 23, 21, 21, 10)
	];

	it('produces one bar per calendar month', () => {
		const m = resampleToMonthly(daily);
		expect(m).toHaveLength(3);
	});

	it('aggregates OHLCV correctly per month', () => {
		const [jan, feb, mar] = resampleToMonthly(daily);
		// January
		expect(jan.o).toBe(10); // first open
		expect(jan.h).toBe(15); // max high
		expect(jan.l).toBe(8); // min low
		expect(jan.c).toBe(13); // last close
		expect(jan.v).toBe(300); // summed volume
		// February
		expect(feb.o).toBe(13);
		expect(feb.h).toBe(20);
		expect(feb.l).toBe(6);
		expect(feb.c).toBe(17);
		expect(feb.v).toBe(200);
		// March
		expect(mar.o).toBe(17);
		expect(mar.h).toBe(25);
		expect(mar.l).toBe(16);
		expect(mar.c).toBe(21);
		expect(mar.v).toBe(310);
	});

	it('stamps each monthly bar at the last available day of that month', () => {
		const [jan, feb, mar] = resampleToMonthly(daily);
		expect(jan.t).toBe('2024-01-20T00:00:00.000Z');
		expect(feb.t).toBe('2024-02-28T00:00:00.000Z');
		expect(mar.t).toBe('2024-03-15T00:00:00.000Z');
	});

	it('returns bars in ascending order', () => {
		const m = resampleToMonthly(daily);
		for (let i = 1; i < m.length; i++) {
			expect(Date.parse(m[i].t)).toBeGreaterThan(Date.parse(m[i - 1].t));
		}
	});

	it('sorts unsorted input before bucketing', () => {
		const shuffled = [daily[4], daily[0], daily[6], daily[2], daily[1], daily[5], daily[3]];
		expect(resampleToMonthly(shuffled)).toEqual(resampleToMonthly(daily));
	});

	it('buckets across year boundaries by UTC year+month', () => {
		const m = resampleToMonthly([
			day('2023-12-29', 1, 2, 1, 2, 5),
			day('2024-01-02', 2, 3, 2, 3, 6)
		]);
		expect(m).toHaveLength(2);
		expect(m[0].t).toBe('2023-12-29T00:00:00.000Z');
		expect(m[1].t).toBe('2024-01-02T00:00:00.000Z');
	});

	it('returns an empty array for empty input', () => {
		expect(resampleToMonthly([])).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// resampleToWeekly
// ---------------------------------------------------------------------------

describe('resampleToWeekly', () => {
	// 2024-01-01 is a Monday (ISO week 1); 2024-01-08 starts ISO week 2.
	const daily: Candle[] = [
		day('2024-01-01', 10, 12, 9, 11, 100), // W1 Mon
		day('2024-01-03', 11, 14, 8, 13, 200), // W1 Wed
		day('2024-01-05', 13, 13, 7, 10, 150), // W1 Fri
		day('2024-01-08', 10, 18, 6, 16, 300), // W2 Mon
		day('2024-01-12', 16, 17, 15, 15, 90) // W2 Fri
	];

	it('produces one bar per ISO week', () => {
		expect(resampleToWeekly(daily)).toHaveLength(2);
	});

	it('aggregates OHLCV correctly per week', () => {
		const [w1, w2] = resampleToWeekly(daily);
		expect(w1.o).toBe(10);
		expect(w1.h).toBe(14);
		expect(w1.l).toBe(7);
		expect(w1.c).toBe(10);
		expect(w1.v).toBe(450);
		expect(w2.o).toBe(10);
		expect(w2.h).toBe(18);
		expect(w2.l).toBe(6);
		expect(w2.c).toBe(15);
		expect(w2.v).toBe(390);
	});

	it('stamps each weekly bar at the last available day of the week', () => {
		const [w1, w2] = resampleToWeekly(daily);
		expect(w1.t).toBe('2024-01-05T00:00:00.000Z');
		expect(w2.t).toBe('2024-01-12T00:00:00.000Z');
	});

	it('returns weekly bars in ascending order', () => {
		const w = resampleToWeekly(daily);
		for (let i = 1; i < w.length; i++) {
			expect(Date.parse(w[i].t)).toBeGreaterThan(Date.parse(w[i - 1].t));
		}
	});

	it('returns an empty array for empty input', () => {
		expect(resampleToWeekly([])).toEqual([]);
	});
});
