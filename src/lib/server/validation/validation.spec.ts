import { describe, it, expect } from 'vitest';
import {
	mean,
	variance,
	stdDev,
	skewness,
	kurtosis,
	sharpe,
	percentile,
	rankOf,
	normalCdf,
	normalInv
} from './stats';
import { makeRng, shuffle, sampleWithReplacement } from './rng';
import { probabilisticSharpe, expectedMaxSharpe, deflatedSharpe } from './deflated-sharpe';
import { combinations, buildPerformanceMatrix, computePBO } from './pbo';
import { generateCpcvSplits, groupBounds } from './cpcv';
import { shuffleTradeOrder, bootstrapReturns, randomizedEntryNull } from './monte-carlo';

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

describe('stats', () => {
	it('mean / variance / std on a known sample', () => {
		const xs = [2, 4, 4, 4, 5, 5, 7, 9];
		expect(mean(xs)).toBeCloseTo(5, 9);
		expect(variance(xs)).toBeCloseTo(4.571428, 4); // sample (ddof=1)
		expect(stdDev(xs)).toBeCloseTo(Math.sqrt(4.571428), 4);
	});

	it('skewness ~0 for a symmetric sample; kurtosis ~3 region', () => {
		const sym = [-3, -2, -1, 0, 1, 2, 3];
		expect(skewness(sym)).toBeCloseTo(0, 6);
		expect(kurtosis(sym)).toBeGreaterThan(1);
	});

	it('normalCdf and normalInv are consistent', () => {
		expect(normalCdf(0)).toBeCloseTo(0.5, 8);
		expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
		expect(normalInv(0.975)).toBeCloseTo(1.959964, 4);
		// round-trip
		for (const x of [-2, -0.5, 0.3, 1.4]) {
			expect(normalInv(normalCdf(x))).toBeCloseTo(x, 5);
		}
	});

	it('percentile interpolates and rankOf measures position', () => {
		const xs = [10, 20, 30, 40, 50];
		expect(percentile(xs, 0)).toBe(10);
		expect(percentile(xs, 1)).toBe(50);
		expect(percentile(xs, 0.5)).toBe(30);
		expect(rankOf(xs, 35)).toBeCloseTo(0.6, 9); // 3 of 5 below
	});

	it('sharpe is mean over sample std', () => {
		const r = [0.01, -0.005, 0.02, 0.0, 0.015];
		expect(sharpe(r)).toBeCloseTo(mean(r) / stdDev(r), 9);
	});
});

// ---------------------------------------------------------------------------
// rng — determinism is non-negotiable (§2.7)
// ---------------------------------------------------------------------------

describe('seeded rng', () => {
	it('same seed yields the same sequence; different seeds differ', () => {
		const a = Array.from({ length: 5 }, () => makeRng(42).next());
		const b = makeRng(42);
		const c = makeRng(43);
		expect(a[0]).toBe(b.next());
		const first42 = makeRng(42).next();
		expect(first42).not.toBe(c.next());
	});

	it('shuffle is a permutation and is deterministic for a seed', () => {
		const xs = [1, 2, 3, 4, 5, 6, 7, 8];
		const s1 = shuffle(xs, makeRng(7));
		const s2 = shuffle(xs, makeRng(7));
		expect(s1).toEqual(s2);
		expect([...s1].sort((a, b) => a - b)).toEqual(xs);
	});

	it('sampleWithReplacement draws the requested count from the pool', () => {
		const xs = [1, 2, 3];
		const s = sampleWithReplacement(xs, 10, makeRng(1));
		expect(s).toHaveLength(10);
		expect(s.every((v) => xs.includes(v))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Deflated Sharpe
// ---------------------------------------------------------------------------

describe('deflated sharpe', () => {
	it('PSR increases with the observed Sharpe', () => {
		const lo = probabilisticSharpe(0.1, 100, 0, 3, 0);
		const hi = probabilisticSharpe(0.4, 100, 0, 3, 0);
		expect(hi).toBeGreaterThan(lo);
	});

	it('expected max Sharpe grows with the number of trials', () => {
		const v = 1 / 249;
		expect(expectedMaxSharpe(v, 1)).toBe(0);
		expect(expectedMaxSharpe(v, 1000)).toBeGreaterThan(expectedMaxSharpe(v, 10));
	});

	it('deflation lowers confidence as more configs are tried', () => {
		const returns = Array.from({ length: 250 }, (_, i) => 0.0008 + 0.012 * Math.sin(i / 3));
		const one = deflatedSharpe(returns, 1);
		const many = deflatedSharpe(returns, 1000);
		expect(one.psr).toBeCloseTo(many.psr, 9); // PSR doesn't depend on trials
		expect(one.dsr).toBeGreaterThan(0.9); // strong on a single trial
		expect(many.dsr).toBeLessThan(one.dsr); // deflated by the search
		expect(many.expectedMaxSharpe).toBeGreaterThan(one.expectedMaxSharpe);
	});
});

// ---------------------------------------------------------------------------
// PBO via CSCV
// ---------------------------------------------------------------------------

describe('PBO (CSCV)', () => {
	it('combinations enumerates C(n,k) sets', () => {
		const c = combinations(4, 2);
		expect(c).toHaveLength(6);
		expect(c).toContainEqual([0, 1]);
		expect(c).toContainEqual([2, 3]);
	});

	it('buildPerformanceMatrix shapes configs × blocks', () => {
		const trials = [
			Array.from({ length: 40 }, () => 0.01),
			Array.from({ length: 40 }, () => -0.01)
		];
		const m = buildPerformanceMatrix(trials, 4);
		expect(m).toHaveLength(2);
		expect(m[0]).toHaveLength(4);
	});

	it('PBO ≈ 0 when one config dominates in every block', () => {
		const blocks = 6;
		const matrix = [
			Array.from({ length: blocks }, () => 100), // config 0 always best
			Array.from({ length: blocks }, () => 0),
			Array.from({ length: blocks }, () => 0)
		];
		const res = computePBO(matrix);
		expect(res.pbo).toBe(0);
		expect(res.pass).toBe(true);
	});

	it('PBO is high when the IS-winner is anti-correlated with OOS', () => {
		const S = 6;
		// config c is brilliant only in block c → IS-best is poor OOS, every split.
		const matrix = Array.from({ length: S }, (_, c) =>
			Array.from({ length: S }, (_, b) => (b === c ? 100 : 0))
		);
		const res = computePBO(matrix);
		expect(res.pbo).toBeGreaterThan(0.5);
		expect(res.pass).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// CPCV — purge + embargo
// ---------------------------------------------------------------------------

describe('CPCV splits', () => {
	it('groupBounds partition [0, n) contiguously', () => {
		const b = groupBounds(100, 5);
		expect(b[0]).toEqual([0, 20]);
		expect(b[4]).toEqual([80, 100]);
	});

	it('generates C(nGroups, nTestGroups) splits with disjoint train/test', () => {
		const splits = generateCpcvSplits(120, 6, 2);
		expect(splits).toHaveLength(15); // C(6,2)
		for (const s of splits) {
			const testSet = new Set(s.test);
			expect(s.train.every((i) => !testSet.has(i))).toBe(true);
		}
	});

	it('purge + embargo remove the halo around every test block from training', () => {
		const n = 120;
		const purge = 3;
		const embargo = 2;
		const splits = generateCpcvSplits(n, 6, 1, { purgeBars: purge, embargoBars: embargo });
		const bounds = groupBounds(n, 6);
		for (const s of splits) {
			for (const g of s.testGroups) {
				const [lo, hi] = bounds[g];
				const from = Math.max(0, lo - purge);
				const to = Math.min(n, hi + purge + embargo);
				// No training index may fall inside the purged+embargoed halo.
				expect(s.train.some((i) => i >= from && i < to)).toBe(false);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Monte Carlo — seeded & deterministic
// ---------------------------------------------------------------------------

describe('monte carlo', () => {
	const tradeReturns = [0.02, -0.01, 0.03, -0.02, 0.01, 0.04, -0.03, 0.02, -0.01, 0.05];

	it('shuffleTradeOrder is deterministic and orders percentiles', () => {
		const a = shuffleTradeOrder(tradeReturns, 100_000, 500, 9);
		const b = shuffleTradeOrder(tradeReturns, 100_000, 500, 9);
		expect(a).toEqual(b);
		expect(a.observed).toBeLessThanOrEqual(0); // max drawdown is non-positive
		expect(a.p05).toBeLessThanOrEqual(a.p50);
		expect(a.p50).toBeLessThanOrEqual(a.p95);
	});

	it('bootstrapReturns is deterministic with ordered percentiles', () => {
		const a = bootstrapReturns(tradeReturns, 100_000, 500, 3);
		const b = bootstrapReturns(tradeReturns, 100_000, 500, 3);
		expect(a).toEqual(b);
		expect(a.p05).toBeLessThanOrEqual(a.p95);
	});

	it('randomizedEntryNull: a strong strategy beats the null, a weak one does not', () => {
		// Gentle uptrend so random long entries make a little money on average.
		const barReturns = Array.from({ length: 300 }, (_, i) => 0.001 + 0.002 * Math.sin(i / 5));
		const strong = randomizedEntryNull(barReturns, 10, 5, 5.0, 800, 11);
		const weak = randomizedEntryNull(barReturns, 10, 5, 0.0, 800, 11);
		expect(strong.pass).toBe(true);
		expect(weak.pass).toBe(false);
		expect(strong).toEqual(randomizedEntryNull(barReturns, 10, 5, 5.0, 800, 11)); // deterministic
	});
});
