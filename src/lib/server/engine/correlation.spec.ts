import { describe, it, expect } from 'vitest';
import { pearson, closeReturns } from './correlation';

describe('pearson', () => {
	it('returns +1 for a perfectly positively correlated pair', () => {
		const a = [1, 2, 3, 4, 5];
		const b = [2, 4, 6, 8, 10]; // b = 2a → perfect positive
		expect(pearson(a, b)).toBeCloseTo(1, 12);
	});

	it('returns -1 for a perfectly negatively correlated pair', () => {
		const a = [1, 2, 3, 4, 5];
		const b = [10, 8, 6, 4, 2]; // strictly decreasing linear → perfect negative
		expect(pearson(a, b)).toBeCloseTo(-1, 12);
	});

	it('returns ~0 for an uncorrelated pair', () => {
		// Symmetric "V" against a monotonic ramp → zero linear correlation.
		const a = [1, 2, 3, 4, 5];
		const b = [2, 1, 0, 1, 2];
		expect(pearson(a, b)).toBeCloseTo(0, 12);
	});

	it('is symmetric: corr(a,b) === corr(b,a)', () => {
		const a = [3, 1, 4, 1, 5, 9, 2, 6];
		const b = [2, 7, 1, 8, 2, 8, 1, 8];
		expect(pearson(a, b)).toBeCloseTo(pearson(b, a), 12);
	});

	it('guards length mismatch → NaN', () => {
		expect(Number.isNaN(pearson([1, 2, 3], [1, 2]))).toBe(true);
	});

	it('guards too-short input (< 2 paired obs) → NaN', () => {
		expect(Number.isNaN(pearson([1], [1]))).toBe(true);
		expect(Number.isNaN(pearson([], []))).toBe(true);
	});

	it('guards zero variance (flat series) → NaN', () => {
		expect(Number.isNaN(pearson([5, 5, 5, 5], [1, 2, 3, 4]))).toBe(true);
		expect(Number.isNaN(pearson([1, 2, 3, 4], [7, 7, 7, 7]))).toBe(true);
	});

	it('clamps to [-1, 1] and never overshoots', () => {
		const a = [0.001, 0.002, 0.003, 0.004];
		const b = [0.002, 0.004, 0.006, 0.008];
		const r = pearson(a, b);
		expect(r).toBeLessThanOrEqual(1);
		expect(r).toBeGreaterThanOrEqual(-1);
		expect(r).toBeCloseTo(1, 12);
	});
});

describe('closeReturns', () => {
	it('computes close-to-close simple returns with length n-1', () => {
		const r = closeReturns([100, 110, 99]);
		expect(r).toHaveLength(2);
		expect(r[0]).toBeCloseTo(0.1, 12); // 110/100 - 1
		expect(r[1]).toBeCloseTo(99 / 110 - 1, 12);
	});

	it('returns empty for fewer than 2 closes', () => {
		expect(closeReturns([100])).toEqual([]);
		expect(closeReturns([])).toEqual([]);
	});

	it('feeds pearson: two identical price paths correlate at +1', () => {
		const closes = [100, 102, 101, 105, 108, 107, 110];
		const ra = closeReturns(closes);
		const rb = closeReturns(closes.map((c) => c * 1.5));
		expect(pearson(ra, rb)).toBeCloseTo(1, 12);
	});

	it('feeds pearson: mirrored price paths correlate at -1', () => {
		// rb returns are the exact negatives of ra returns by construction.
		const ra = [0.01, -0.02, 0.03, -0.01, 0.02];
		const rb = ra.map((x) => -x);
		expect(pearson(ra, rb)).toBeCloseTo(-1, 12);
	});
});
