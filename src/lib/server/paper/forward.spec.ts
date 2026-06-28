import { describe, it, expect } from 'vitest';
import type {
	BinaryOperator,
	Candle,
	ConditionGroup,
	ConditionLeaf,
	Operand,
	PriceField,
	StrategySpec
} from '$lib/types';
import { runBacktest } from '../engine/engine';
import { computeForwardState, divergence } from './forward';

// ---------------------------------------------------------------------------
// Fixtures (mirror engine.spec.ts)
// ---------------------------------------------------------------------------

function candles(closes: number[]): Candle[] {
	// o = previous close (or first close), h/l bracket the bar by ±0.5 so intrabar
	// stops/targets have room but don't trigger spuriously here.
	return closes.map((c, i) => {
		const o = i === 0 ? c : closes[i - 1];
		const hi = Math.max(o, c) + 0.5;
		const lo = Math.min(o, c) - 0.5;
		return {
			t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
			o,
			h: hi,
			l: lo,
			c,
			v: 1000
		};
	});
}

function group(logic: 'AND' | 'OR', children: (ConditionLeaf | ConditionGroup)[]): ConditionGroup {
	return { kind: 'group', id: `g_${Math.random().toString(36).slice(2)}`, logic, children };
}

function emptyGroup(): ConditionGroup {
	return group('AND', []);
}

function binary(left: Operand, op: BinaryOperator, right: Operand): ConditionLeaf {
	return { kind: 'binary', id: `l_${Math.random().toString(36).slice(2)}`, left, op, right };
}

const price = (field: PriceField, offset = 0): Operand => ({ kind: 'price', field, offset });
const constant = (value: number): Operand => ({ kind: 'constant', value });

function baseSpec(overrides: Partial<StrategySpec> = {}): StrategySpec {
	return {
		schemaVersion: 1,
		name: 'Test',
		universe: {
			tickers: ['TEST'],
			timeframe: '1d',
			dateRange: { from: '2024-01-01', to: '2024-12-31' },
			session: { kind: 'RTH' }
		},
		indicators: [],
		rules: {
			longEntry: emptyGroup(),
			longExit: emptyGroup(),
			shortEntry: emptyGroup(),
			shortExit: emptyGroup()
		},
		risk: {
			initialCapital: 100_000,
			positionSizing: { mode: 'fixedShares', shares: 100 },
			stopLoss: { mode: 'none' },
			takeProfit: { mode: 'none' },
			trailingStop: { mode: 'none' },
			maxConcurrentPositions: 1,
			pyramiding: 0,
			commission: { mode: 'none' },
			slippage: { mode: 'none' }
		},
		execution: { fillOn: 'nextOpen', orderType: 'market' },
		...overrides
	};
}

const crossoverRules = {
	longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
	longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
	shortEntry: emptyGroup(),
	shortExit: emptyGroup()
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeForwardState — current signals at the last bar', () => {
	it('reports longEntry active and asOf = last timestamp on a fresh crossover', () => {
		// Last two closes are 104 → 106: crossover over 105 is TRUE at the last bar.
		const data = candles([100, 102, 104, 106, 104, 106]);
		const spec = baseSpec({ rules: crossoverRules });
		const state = computeForwardState(spec, { TEST: data });

		expect(state.asOf).toBe(data[data.length - 1].t);

		const t = state.perTicker.find((p) => p.ticker === 'TEST');
		expect(t).toBeDefined();
		expect(t!.signals.longEntry).toBe(true);
		expect(t!.signals.longExit).toBe(false);
		expect(t!.signals.shortEntry).toBe(false);
		expect(t!.signals.shortExit).toBe(false);
		expect(t!.lastClose).toBe(106);
		expect(state.pendingLong).toBe(true);
		expect(state.pendingShortExit).toBe(false);
	});

	it('reports longExit active when the last bar crosses under', () => {
		// Last two closes 106 → 104: crossunder over 105 is TRUE at the last bar.
		const data = candles([100, 104, 106, 108, 106, 104]);
		const spec = baseSpec({ rules: crossoverRules });
		const state = computeForwardState(spec, { TEST: data });

		const t = state.perTicker.find((p) => p.ticker === 'TEST')!;
		expect(t.signals.longExit).toBe(true);
		expect(t.signals.longEntry).toBe(false);
		expect(state.asOf).toBe(data[data.length - 1].t);
	});

	it('reports no signals on a flat last bar', () => {
		const data = candles([100, 101, 102, 103, 104]); // never crosses 105
		const spec = baseSpec({ rules: crossoverRules });
		const state = computeForwardState(spec, { TEST: data });

		const t = state.perTicker.find((p) => p.ticker === 'TEST')!;
		expect(t.signals.longEntry).toBe(false);
		expect(t.signals.longExit).toBe(false);
		expect(state.pendingLong).toBe(false);
		expect(state.openPositions.length).toBe(0);
	});
});

describe('computeForwardState — still-open positions at the last bar', () => {
	it('reports a position that the engine carried to end-of-data as still open', () => {
		// Long opens on the crossover (fill next open), never exits → open at the
		// last bar. Derived from the engine run via the endOfData close.
		const spec = baseSpec({
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const data = candles([100, 102, 104, 106, 108, 110]);
		const state = computeForwardState(spec, { TEST: data });

		expect(state.openPositions.length).toBe(1);
		const pos = state.openPositions[0];
		expect(pos.ticker).toBe('TEST');
		expect(pos.side).toBe('long');
		expect(pos.qty).toBe(100);
		expect(pos.entryPrice).toBe(106); // open of bar after the crossover

		// The same position appears in the per-ticker breakdown.
		const t = state.perTicker.find((p) => p.ticker === 'TEST')!;
		expect(t.openPositions.length).toBe(1);
		expect(t.openPositions[0]).toEqual(pos);
	});

	it('reports no open position once a signal exit closed the trade', () => {
		// Opens then closes on a crossunder before end-of-data → flat at the last bar.
		const spec = baseSpec({ rules: crossoverRules });
		const data = candles([100, 102, 104, 106, 108, 104, 102, 100]);
		const state = computeForwardState(spec, { TEST: data });
		expect(state.openPositions.length).toBe(0);
		const t = state.perTicker.find((p) => p.ticker === 'TEST')!;
		expect(t.openPositions.length).toBe(0);
	});
});

describe('computeForwardState — multiple tickers & no data', () => {
	it('keeps per-ticker order from the universe and handles empty candles', () => {
		const spec = baseSpec({
			universe: { ...baseSpec().universe, tickers: ['AAA', 'EMPTY'] },
			rules: crossoverRules
		});
		const data = { AAA: candles([100, 102, 104, 106, 104, 106]), EMPTY: [] as Candle[] };
		const state = computeForwardState(spec, data);

		expect(state.perTicker.map((p) => p.ticker)).toEqual(['AAA', 'EMPTY']);

		const empty = state.perTicker.find((p) => p.ticker === 'EMPTY')!;
		expect(empty.lastBarTime).toBeNull();
		expect(empty.lastClose).toBeNull();
		expect(empty.signals.longEntry).toBe(false);

		// asOf comes from the ticker that has data.
		expect(state.asOf).toBe(data.AAA[data.AAA.length - 1].t);
	});
});

describe('divergence — drift monitor', () => {
	it('is zero / identical for two identical results', () => {
		const spec = baseSpec({ rules: crossoverRules });
		const data = { TEST: candles([100, 102, 104, 106, 108, 104, 102, 100]) };
		const a = runBacktest(spec, data);
		const b = runBacktest(spec, data);

		const d = divergence(a, b);
		expect(d.tradeCountDelta).toBe(0);
		expect(d.lastEquityDelta).toBe(0);
		expect(d.identical).toBe(true);
	});

	it('reports a non-zero trade-count delta when the live run diverges', () => {
		const spec = baseSpec({ rules: crossoverRules });
		// Backtest: one full round-trip (open + signal exit).
		const backtest = runBacktest(spec, {
			TEST: candles([100, 102, 104, 106, 108, 104, 102, 100])
		});
		// Live: a second crossover later adds another trade.
		const live = runBacktest(spec, {
			TEST: candles([100, 102, 104, 106, 108, 104, 102, 100, 104, 106, 104])
		});

		const d = divergence(backtest, live);
		expect(d.identical).toBe(false);
		expect(d.tradeCountDelta).toBeGreaterThan(0);
	});
});
