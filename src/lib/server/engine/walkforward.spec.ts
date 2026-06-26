import { describe, it, expect } from 'vitest';
import type { Candle, ConditionGroup, StrategySpec } from '$lib/types';
import { splitWalkForward, sliceCandles, runWalkForward } from './walkforward';

const emptyGroup = (): ConditionGroup => ({ kind: 'group', id: 'g', logic: 'AND', children: [] });

function baseSpec(): StrategySpec {
	return {
		schemaVersion: 1,
		name: 'wf',
		universe: {
			tickers: ['T'],
			timeframe: '1d',
			dateRange: { from: '2024-01-01', to: '2024-12-31' },
			session: { kind: 'RTH' }
		},
		indicators: [{ id: 'ema1', type: 'ema', params: { period: 5 }, priceSource: 'close' }],
		rules: {
			longEntry: emptyGroup(),
			longExit: emptyGroup(),
			shortEntry: emptyGroup(),
			shortExit: emptyGroup()
		},
		risk: {
			initialCapital: 100000,
			positionSizing: { mode: 'percentEquity', percent: 10 },
			stopLoss: { mode: 'none' },
			takeProfit: { mode: 'none' },
			trailingStop: { mode: 'none' },
			maxConcurrentPositions: 1,
			pyramiding: 0,
			commission: { mode: 'none' },
			slippage: { mode: 'none' }
		},
		execution: { fillOn: 'nextOpen', orderType: 'market' }
	};
}

const candles: Candle[] = Array.from({ length: 360 }, (_, i) => ({
	t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
	o: 100 + i,
	h: 101 + i,
	l: 99 + i,
	c: 100 + i,
	v: 1000
}));

describe('splitWalkForward', () => {
	it('produces N anchored IS→OOS windows with contiguous boundaries', () => {
		const splits = splitWalkForward('2024-01-01', '2025-01-01', 3);
		expect(splits.length).toBe(3);
		// anchored: every IS starts at the global start
		for (const s of splits) expect(s.isFrom).toBe('2024-01-01');
		// each OOS begins where its IS ends; windows march forward
		for (const s of splits) expect(s.oosFrom).toBe(s.isTo);
		expect(splits[1].isTo > splits[0].isTo).toBe(true);
		expect(splits[splits.length - 1].oosTo).toBe('2025-01-01');
	});

	it('returns nothing for invalid input', () => {
		expect(splitWalkForward('2024-01-01', '2023-01-01', 3)).toEqual([]);
		expect(splitWalkForward('2024-01-01', '2025-01-01', 0)).toEqual([]);
	});
});

describe('sliceCandles', () => {
	it('keeps only candles within the window', () => {
		const sliced = sliceCandles({ T: candles }, '2024-02-01', '2024-02-29');
		expect(sliced.T.length).toBeGreaterThan(0);
		for (const c of sliced.T) {
			const t = Date.parse(c.t);
			expect(t).toBeGreaterThanOrEqual(Date.parse('2024-02-01T00:00:00Z'));
			expect(t).toBeLessThanOrEqual(Date.parse('2024-02-29T00:00:00Z'));
		}
	});
});

describe('runWalkForward', () => {
	it('runs each window (optimize IS, test OOS) and aggregates', () => {
		const result = runWalkForward(
			{
				base: baseSpec(),
				params: [{ indicatorId: 'ema1', param: 'period', values: [3, 5, 10] }],
				windows: 3
			},
			{ T: candles }
		);
		expect(result.windows.length).toBe(3);
		for (const w of result.windows) {
			expect(w.isFrom).toBe('2024-01-01'); // anchored
			expect(w.oosFrom).toBe(w.isTo);
			expect(w.bestOverrides[0]?.indicatorId).toBe('ema1');
			expect(Number.isFinite(w.oosTotalReturn)).toBe(true);
		}
		expect(Number.isFinite(result.combinedOosReturn)).toBe(true);
		expect(Number.isFinite(result.efficiency)).toBe(true);
	});
});
