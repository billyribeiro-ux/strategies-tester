import { describe, it, expect } from 'vitest';
import type { Candle } from '$lib/types';
import { computeBenchmark } from './benchmark';

const c = (t: string, close: number): Candle => ({
	t,
	o: close,
	h: close,
	l: close,
	c: close,
	v: 0
});

describe('computeBenchmark', () => {
	it('computes buy-and-hold equity normalized to initial capital', () => {
		const candles = [
			c('2024-01-01T00:00:00Z', 100),
			c('2024-01-02T00:00:00Z', 110),
			c('2024-01-03T00:00:00Z', 120)
		];
		const b = computeBenchmark('SPY', candles, 100000);
		expect(b.symbol).toBe('SPY');
		expect(b.equity.length).toBe(3);
		expect(b.equity[0].equity).toBeCloseTo(100000, 6);
		expect(b.equity[2].equity).toBeCloseTo(120000, 6); // 120/100 × 100k
		expect(b.returnPct).toBeCloseTo(0.2, 6);
	});

	it('handles empty / invalid candles', () => {
		expect(computeBenchmark('SPY', [], 100000)).toEqual({
			symbol: 'SPY',
			equity: [],
			returnPct: 0
		});
	});
});
