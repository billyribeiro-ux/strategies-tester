import { describe, it, expect } from 'vitest';
import type { Candle, OptimizationSpec, OptimizeParam, StrategySpec } from '$lib/types';
import {
	equityToReturns,
	extractTradeReturns,
	parameterPlateau,
	validateSingle,
	validateOptimization
} from './report';

// --- fixtures (mirror engine.spec.ts) -------------------------------------

function candles(closes: number[]): Candle[] {
	return closes.map((c, i) => {
		const o = i === 0 ? c : closes[i - 1];
		return {
			t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
			o,
			h: Math.max(o, c) + 0.5,
			l: Math.min(o, c) - 0.5,
			c,
			v: 1000
		};
	});
}

function smaCrossSpec(): StrategySpec {
	return {
		schemaVersion: 1,
		name: 'V',
		universe: {
			tickers: ['TEST'],
			timeframe: '1d',
			dateRange: { from: '2024-01-01', to: '2024-12-31' },
			session: { kind: 'RTH' }
		},
		indicators: [{ id: 'sma_fast', type: 'sma', params: { period: 5 }, priceSource: 'close' }],
		rules: {
			longEntry: {
				kind: 'group',
				id: 'g1',
				logic: 'AND',
				children: [
					{
						kind: 'binary',
						id: 'l1',
						left: { kind: 'price', field: 'close', offset: 0 },
						op: 'crossover',
						right: { kind: 'indicator', ref: 'sma_fast', component: 'value', offset: 0 }
					}
				]
			},
			longExit: {
				kind: 'group',
				id: 'g2',
				logic: 'AND',
				children: [
					{
						kind: 'binary',
						id: 'l2',
						left: { kind: 'price', field: 'close', offset: 0 },
						op: 'crossunder',
						right: { kind: 'indicator', ref: 'sma_fast', component: 'value', offset: 0 }
					}
				]
			},
			shortEntry: { kind: 'group', id: 'g3', logic: 'AND', children: [] },
			shortExit: { kind: 'group', id: 'g4', logic: 'AND', children: [] }
		},
		risk: {
			initialCapital: 100_000,
			positionSizing: { mode: 'percentEquity', percent: 50 },
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

const oscillating = (n: number) => Array.from({ length: n }, (_, i) => 105 + Math.sin(i / 2) * 7);

// --- helpers ---------------------------------------------------------------

describe('equityToReturns / extractTradeReturns', () => {
	it('computes per-bar simple returns', () => {
		const r = equityToReturns([
			{ t: 'a', equity: 100 },
			{ t: 'b', equity: 110 },
			{ t: 'c', equity: 99 }
		]);
		expect(r).toHaveLength(2);
		expect(r[0]).toBeCloseTo(0.1, 9);
		expect(r[1]).toBeCloseTo(-0.1, 9);
	});

	it('pulls pnlPct from trades', () => {
		const rets = extractTradeReturns([{ pnlPct: 0.02 } as never, { pnlPct: -0.01 } as never]);
		expect(rets).toEqual([0.02, -0.01]);
	});
});

describe('parameterPlateau', () => {
	const params: OptimizeParam[] = [
		{ indicatorId: 'sma_fast', param: 'period', values: [3, 5, 7, 9, 11] }
	];
	const make = (period: number, metric: number) => ({
		overrides: [{ indicatorId: 'sma_fast', param: 'period', value: period }],
		metric
	});

	it('flags a plateau when neighbours retain performance', () => {
		const combos = [make(3, 8), make(5, 9), make(7, 10), make(9, 9), make(11, 8)];
		const p = parameterPlateau(combos, params);
		expect(p).not.toBeNull();
		expect(p!.isPlateau).toBe(true);
		expect(p!.robustness).toBeGreaterThan(0.7);
	});

	it('flags a spike when neighbours collapse', () => {
		const combos = [make(3, 1), make(5, 1), make(7, 20), make(9, 1), make(11, 1)];
		const p = parameterPlateau(combos, params);
		expect(p!.isPlateau).toBe(false);
		expect(p!.robustness).toBeLessThan(0.3);
	});
});

// --- single-run validation -------------------------------------------------

describe('validateSingle', () => {
	it('produces a report with DSR and Monte-Carlo for a trading strategy', () => {
		const report = validateSingle(smaCrossSpec(), { TEST: candles(oscillating(120)) });
		expect(report.nTrials).toBe(1);
		expect(report.nObservations).toBeGreaterThan(0);
		expect(Number.isFinite(report.deflatedSharpe.dsr)).toBe(true);
		expect(report.pbo).toBeNull(); // no parameter search
		expect(['pass', 'warn', 'fail']).toContain(report.verdict);
		// With multiple trades, the Monte-Carlo blocks are populated.
		expect(report.tradeOrderMonteCarlo).not.toBeNull();
		expect(report.randomizedEntry).not.toBeNull();
	});

	it('is deterministic (same inputs ⇒ identical report)', () => {
		const data = { TEST: candles(oscillating(120)) };
		expect(validateSingle(smaCrossSpec(), data)).toEqual(validateSingle(smaCrossSpec(), data));
	});
});

// --- optimization validation ----------------------------------------------

describe('validateOptimization', () => {
	function optSpec(): OptimizationSpec {
		return {
			base: smaCrossSpec(),
			params: [{ indicatorId: 'sma_fast', param: 'period', values: [3, 5, 7, 9, 11, 13] }],
			sortMetric: 'totalReturn'
		};
	}

	it('runs the grid and reports DSR, PBO and a plateau', () => {
		const report = validateOptimization(optSpec(), { TEST: candles(oscillating(160)) });
		expect(report.nTrials).toBe(6); // grid size
		expect(report.deflatedSharpe.nTrials).toBe(6);
		expect(report.pbo).not.toBeNull(); // 160 bars → enough for CSCV blocks
		expect(report.plateau).not.toBeNull();
		expect(['pass', 'warn', 'fail']).toContain(report.verdict);
	});

	it('deflates more aggressively than a single trial', () => {
		const data = { TEST: candles(oscillating(160)) };
		const single = validateSingle(smaCrossSpec(), data);
		const optimized = validateOptimization(optSpec(), data);
		// More trials ⇒ a higher Sharpe bar to clear.
		expect(optimized.deflatedSharpe.expectedMaxSharpe).toBeGreaterThanOrEqual(
			single.deflatedSharpe.expectedMaxSharpe
		);
	});
});
