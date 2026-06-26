import { describe, it, expect } from 'vitest';
import type {
	Candle,
	ConditionGroup,
	MetricValue,
	OptimizationCombo,
	StrategySpec
} from '$lib/types';
import { enumerateCombos, applyOverrides, rankCombos, runOptimization } from './optimize';

const emptyGroup = (): ConditionGroup => ({ kind: 'group', id: 'g', logic: 'AND', children: [] });

function baseSpec(): StrategySpec {
	return {
		schemaVersion: 1,
		name: 'opt',
		universe: {
			tickers: ['T'],
			timeframe: '1d',
			dateRange: { from: '2024-01-01', to: '2024-03-01' },
			session: { kind: 'RTH' }
		},
		indicators: [
			{ id: 'ema1', type: 'ema', params: { period: 5 }, priceSource: 'close' },
			{ id: 'rsi1', type: 'rsi', params: { period: 14 }, priceSource: 'close' }
		],
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

const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
	t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
	o: 100 + i,
	h: 101 + i,
	l: 99 + i,
	c: 100 + i,
	v: 1000
}));

describe('enumerateCombos', () => {
	it('produces the cartesian product across params', () => {
		const combos = enumerateCombos([
			{ indicatorId: 'ema1', param: 'period', values: [5, 10] },
			{ indicatorId: 'rsi1', param: 'period', values: [7, 14, 21] }
		]);
		expect(combos.length).toBe(6);
		// every combo carries one override per param
		for (const c of combos) expect(c.length).toBe(2);
	});

	it('ignores params with no values and yields one empty combo for none', () => {
		expect(enumerateCombos([{ indicatorId: 'ema1', param: 'period', values: [] }])).toEqual([[]]);
		expect(enumerateCombos([])).toEqual([[]]);
	});
});

describe('applyOverrides', () => {
	it('sets the targeted param without mutating the base', () => {
		const base = baseSpec();
		const out = applyOverrides(base, [{ indicatorId: 'ema1', param: 'period', value: 20 }]);
		expect(out.indicators.find((i) => i.id === 'ema1')?.params.period).toBe(20);
		// base untouched + other indicators intact
		expect(base.indicators.find((i) => i.id === 'ema1')?.params.period).toBe(5);
		expect(out.indicators.find((i) => i.id === 'rsi1')?.params.period).toBe(14);
	});
});

describe('rankCombos', () => {
	const mk = (id: string, metrics: Partial<MetricValue>[]): OptimizationCombo => ({
		id,
		overrides: [],
		totalReturn: 0,
		sharpe: 0,
		maxDrawdown: 0,
		winRate: 0,
		totalTrades: 0,
		metrics: metrics as MetricValue[]
	});

	it('ranks higher-is-better metrics descending', () => {
		const ranked = rankCombos(
			[
				mk('a', [{ id: 'totalReturn', value: 0.1, betterWhenHigher: true }]),
				mk('b', [{ id: 'totalReturn', value: 0.5, betterWhenHigher: true }]),
				mk('c', [{ id: 'totalReturn', value: 0.3, betterWhenHigher: true }])
			],
			'totalReturn'
		);
		expect(ranked.map((c) => c.id)).toEqual(['b', 'c', 'a']);
	});

	it('ranks maxDrawdown best-first (least-negative first)', () => {
		const ranked = rankCombos(
			[
				mk('a', [{ id: 'maxDrawdown', value: -0.2, betterWhenHigher: false }]),
				mk('b', [{ id: 'maxDrawdown', value: -0.05, betterWhenHigher: false }]),
				mk('c', [{ id: 'maxDrawdown', value: -0.1, betterWhenHigher: false }])
			],
			'maxDrawdown'
		);
		// least-negative drawdown first
		expect(ranked.map((c) => c.id)).toEqual(['b', 'c', 'a']);
	});
});

describe('runOptimization', () => {
	it('runs one backtest per combo and returns a ranked result', () => {
		const result = runOptimization(
			{ base: baseSpec(), params: [{ indicatorId: 'ema1', param: 'period', values: [3, 5, 10] }] },
			{ T: candles }
		);
		expect(result.totalCombos).toBe(3);
		expect(result.ran).toBe(3);
		expect(result.combos.length).toBe(3);
		expect(result.capped).toBe(false);
		expect(result.best).not.toBeNull();
		// each combo carries its override
		for (const c of result.combos) {
			expect(c.overrides[0].indicatorId).toBe('ema1');
			expect([3, 5, 10]).toContain(c.overrides[0].value);
		}
	});

	it('caps the number of runs', () => {
		const result = runOptimization(
			{
				base: baseSpec(),
				params: [{ indicatorId: 'ema1', param: 'period', values: [3, 5, 10, 20] }]
			},
			{ T: candles },
			2
		);
		expect(result.totalCombos).toBe(4);
		expect(result.ran).toBe(2);
		expect(result.capped).toBe(true);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
});
