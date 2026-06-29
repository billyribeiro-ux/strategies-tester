import { describe, it, expect } from 'vitest';
import { fetchSectors, groupBySector, sectorExposure, UNKNOWN_SECTOR } from './sectors';
import type { SectorMap } from './sectors';
import type { FetchFn } from './types';

// ---------------------------------------------------------------------------
// Helpers / fixtures (deterministic — no Date.now / Math.random)
// ---------------------------------------------------------------------------

/**
 * A stub fetch that serves canned JSON per matched URL substring. Routes are
 * tested in order, so list more-specific matches first. Profile URLs embed the
 * symbol as `symbol=SYM`, so matching on `symbol=SYM&` routes per symbol.
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
		// Unmatched -> empty array (valid but empty -> no sector).
		return { ok: true, status: 200, json: async () => [] } as unknown as Response;
	}) as FetchFn;
}

// ---------------------------------------------------------------------------
// fetchSectors
// ---------------------------------------------------------------------------

describe('fetchSectors', () => {
	it('builds a SectorMap from per-symbol profile responses', async () => {
		const fetchFn = stubFetch([
			{ match: 'symbol=AAPL&', body: [{ symbol: 'AAPL', sector: 'Technology' }] },
			{ match: 'symbol=JPM&', body: [{ symbol: 'JPM', sector: 'Financial Services' }] }
		]);
		const { sectors, gaps } = await fetchSectors(['AAPL', 'JPM'], 'k', fetchFn);
		expect(sectors).toEqual({ AAPL: 'Technology', JPM: 'Financial Services' });
		expect(gaps).toEqual([]);
	});

	it('tolerates a single object (not array-wrapped) and an object-wrapped array', async () => {
		const fetchFn = stubFetch([
			// Bare object response.
			{ match: 'symbol=AAPL&', body: { symbol: 'AAPL', sector: 'Technology' } },
			// Object-wrapped array response.
			{ match: 'symbol=XOM&', body: { results: [{ symbol: 'XOM', sector: 'Energy' }] } }
		]);
		const { sectors, gaps } = await fetchSectors(['AAPL', 'XOM'], 'k', fetchFn);
		expect(sectors).toEqual({ AAPL: 'Technology', XOM: 'Energy' });
		expect(gaps).toEqual([]);
	});

	it('maps a missing sector to the Unknown sentinel and records a gap', async () => {
		const fetchFn = stubFetch([
			{ match: 'symbol=AAPL&', body: [{ symbol: 'AAPL', sector: 'Technology' }] },
			// Profile present but no `sector` field.
			{ match: 'symbol=ZZZ&', body: [{ symbol: 'ZZZ', companyName: 'Mystery Inc' }] }
		]);
		const { sectors, gaps } = await fetchSectors(['AAPL', 'ZZZ'], 'k', fetchFn);
		expect(sectors).toEqual({ AAPL: 'Technology', ZZZ: UNKNOWN_SECTOR });
		expect(gaps).toHaveLength(1);
		expect(gaps[0].detail).toContain('ZZZ');
	});

	it('maps an empty-array profile (unknown symbol) to Unknown with a gap', async () => {
		// No route matches -> stub returns [] -> no sector resolvable.
		const fetchFn = stubFetch([]);
		const { sectors, gaps } = await fetchSectors(['NOPE'], 'k', fetchFn);
		expect(sectors).toEqual({ NOPE: UNKNOWN_SECTOR });
		expect(gaps).toHaveLength(1);
		expect(gaps[0].detail).toContain('NOPE');
	});

	it('records a gap and does not throw on an HTTP error response', async () => {
		const fetchFn = stubFetch([
			{ match: 'symbol=BAD&', body: { 'Error Message': 'nope' }, status: 403 }
		]);
		const { sectors, gaps } = await fetchSectors(['BAD'], 'k', fetchFn);
		expect(sectors).toEqual({ BAD: UNKNOWN_SECTOR });
		expect(gaps.some((g) => g.detail.includes('HTTP 403'))).toBe(true);
	});

	it('records a gap when fetch rejects (network failure), without throwing', async () => {
		const fetchFn = (async () => {
			throw new Error('boom');
		}) as FetchFn;
		const { sectors, gaps } = await fetchSectors(['AAPL'], 'k', fetchFn);
		expect(sectors).toEqual({ AAPL: UNKNOWN_SECTOR });
		expect(gaps.some((g) => g.detail.toLowerCase().includes('could not reach'))).toBe(true);
	});

	it('records a gap on an unexpected JSON shape (explicit error message)', async () => {
		const fetchFn = stubFetch([{ match: 'symbol=AAPL&', body: { 'Error Message': 'limit' } }]);
		const { sectors, gaps } = await fetchSectors(['AAPL'], 'k', fetchFn);
		expect(sectors).toEqual({ AAPL: UNKNOWN_SECTOR });
		expect(gaps.some((g) => g.detail.toLowerCase().includes('limit'))).toBe(true);
	});

	it('normalizes and de-duplicates symbols; empty input -> empty map', async () => {
		const fetchFn = stubFetch([
			{ match: 'symbol=AAPL&', body: [{ symbol: 'AAPL', sector: 'Technology' }] }
		]);
		// Mixed case + whitespace + duplicates + blanks collapse to a single key.
		const { sectors } = await fetchSectors([' aapl ', 'AAPL', 'aapl', ''], 'k', fetchFn);
		expect(sectors).toEqual({ AAPL: 'Technology' });

		const empty = await fetchSectors([], 'k', fetchFn);
		expect(empty.sectors).toEqual({});
		expect(empty.gaps).toEqual([]);
	});

	it('uses the /stable/profile endpoint with symbol and apikey', async () => {
		const seen: string[] = [];
		const fetchFn = (async (input: RequestInfo | URL) => {
			seen.push(String(input));
			return { ok: true, status: 200, json: async () => [] } as unknown as Response;
		}) as FetchFn;
		await fetchSectors(['AAPL'], 'secret-key', fetchFn);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toContain('/stable/profile?');
		expect(seen[0]).toContain('symbol=AAPL');
		expect(seen[0]).toContain('apikey=secret-key');
	});
});

// ---------------------------------------------------------------------------
// groupBySector (pure)
// ---------------------------------------------------------------------------

describe('groupBySector', () => {
	it('inverts the map and sorts sectors and symbols deterministically', () => {
		const sectors: SectorMap = {
			MSFT: 'Technology',
			AAPL: 'Technology',
			JPM: 'Financial Services',
			XOM: 'Energy'
		};
		const grouped = groupBySector(sectors);
		// Sectors sorted alphabetically.
		expect(Object.keys(grouped)).toEqual(['Energy', 'Financial Services', 'Technology']);
		// Symbols within a sector sorted alphabetically.
		expect(grouped['Technology']).toEqual(['AAPL', 'MSFT']);
		expect(grouped['Financial Services']).toEqual(['JPM']);
		expect(grouped['Energy']).toEqual(['XOM']);
	});

	it('is deterministic regardless of input key ordering', () => {
		const a: SectorMap = { AAPL: 'Technology', MSFT: 'Technology', JPM: 'Financials' };
		const b: SectorMap = { JPM: 'Financials', MSFT: 'Technology', AAPL: 'Technology' };
		expect(groupBySector(a)).toEqual(groupBySector(b));
	});

	it('returns an empty object for an empty map', () => {
		expect(groupBySector({})).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// sectorExposure (pure)
// ---------------------------------------------------------------------------

describe('sectorExposure', () => {
	const sectors: SectorMap = {
		AAPL: 'Technology',
		MSFT: 'Technology',
		JPM: 'Financial Services',
		XOM: 'Energy'
	};

	it('counts open symbols per sector', () => {
		const exposure = sectorExposure(['AAPL', 'MSFT', 'JPM'], sectors);
		expect(exposure).toEqual({ 'Financial Services': 1, Technology: 2 });
	});

	it('counts a symbol with no known sector under Unknown', () => {
		const exposure = sectorExposure(['AAPL', 'TSLA'], sectors);
		expect(exposure).toEqual({ Technology: 1, [UNKNOWN_SECTOR]: 1 });
	});

	it('normalizes symbol casing/whitespace so a bucket is not split', () => {
		const exposure = sectorExposure([' aapl ', 'AAPL', 'msft'], sectors);
		expect(exposure).toEqual({ Technology: 3 });
	});

	it('sorts output keys deterministically', () => {
		const exposure = sectorExposure(['XOM', 'AAPL', 'JPM'], sectors);
		expect(Object.keys(exposure)).toEqual(['Energy', 'Financial Services', 'Technology']);
	});

	it('returns an empty object for no open symbols', () => {
		expect(sectorExposure([], sectors)).toEqual({});
	});
});
