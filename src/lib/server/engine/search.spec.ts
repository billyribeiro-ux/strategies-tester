import { describe, it, expect } from 'vitest';
import type {
	BinaryOperator,
	Candle,
	ConditionGroup,
	ConditionLeaf,
	Operand,
	OptimizationSpec,
	PriceField,
	StrategySpec
} from '$lib/types';
import { geneticSearch, objectives, randomSearch, type Objective } from './search';
import { enumerateCombos } from './optimize';

// ---------------------------------------------------------------------------
// Fixtures (small helpers mirrored from engine.spec.ts, kept self-contained)
// ---------------------------------------------------------------------------

function candles(closes: number[]): Candle[] {
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

// Deterministic, fixed ids (no Math.random) so search results are comparable.
let leafSeq = 0;
function group(logic: 'AND' | 'OR', children: (ConditionLeaf | ConditionGroup)[]): ConditionGroup {
	return { kind: 'group', id: `g_${leafSeq++}`, logic, children };
}
function emptyGroup(): ConditionGroup {
	return group('AND', []);
}
function binary(left: Operand, op: BinaryOperator, right: Operand): ConditionLeaf {
	return { kind: 'binary', id: `l_${leafSeq++}`, left, op, right };
}
const price = (field: PriceField, offset = 0): Operand => ({ kind: 'price', field, offset });
const indicator = (ref: string, component = 'value', offset = 0): Operand => ({
	kind: 'indicator',
	ref,
	component,
	offset
});

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
		indicators: [{ id: 'sma', type: 'sma', params: { period: 3 }, priceSource: 'close' }],
		rules: {
			longEntry: group('AND', [binary(price('close'), 'crossover', indicator('sma'))]),
			longExit: group('AND', [binary(price('close'), 'crossunder', indicator('sma'))]),
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

/** Oscillating series so the SMA crossover strategy actually trades. */
const OSC = candles(
	Array.from({ length: 48 }, (_, i) => 100 + Math.sin(i / 3) * 6 + Math.cos(i / 5) * 3)
);
const DATA = { TEST: OSC };

/** A spec sweeping the sma period over a small grid. */
function sweepSpec(values: number[]): OptimizationSpec {
	return {
		base: baseSpec(),
		params: [{ indicatorId: 'sma', param: 'period', values }]
	};
}

/** Drop fields that legitimately vary (combo ids, warning text) for deep compare. */
function comboShape(r: ReturnType<typeof randomSearch>) {
	return r.combos.map((c) => ({
		overrides: c.overrides,
		totalReturn: c.totalReturn,
		sharpe: c.sharpe,
		maxDrawdown: c.maxDrawdown,
		winRate: c.winRate,
		totalTrades: c.totalTrades
	}));
}

// ---------------------------------------------------------------------------
// objectives
// ---------------------------------------------------------------------------

describe('objectives', () => {
	it('return finite numbers for a real backtest result', async () => {
		const { runBacktest } = await import('./engine');
		const result = runBacktest(baseSpec(), DATA);
		for (const key of Object.keys(objectives)) {
			const score = objectives[key](result);
			expect(Number.isFinite(score)).toBe(true);
		}
	});

	it('oosDeflatedProxy never exceeds raw sharpe in magnitude when sharpe >= 0', async () => {
		const { runBacktest } = await import('./engine');
		const result = runBacktest(baseSpec(), DATA);
		const sharpe = objectives.sharpe(result);
		const deflated = objectives.oosDeflatedProxy(result);
		if (sharpe >= 0) expect(deflated).toBeLessThanOrEqual(sharpe + 1e-9);
		expect(Number.isFinite(deflated)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// randomSearch
// ---------------------------------------------------------------------------

describe('randomSearch', () => {
	it('is deterministic for a fixed seed (deep-equal results)', () => {
		const spec = sweepSpec([2, 3, 4, 5, 6, 7, 8, 9]);
		const a = randomSearch(spec, DATA, { iterations: 5, seed: 42 });
		const b = randomSearch(spec, DATA, { iterations: 5, seed: 42 });
		expect(a).toEqual(b);
	});

	it('different seeds may produce a different sample', () => {
		const spec = sweepSpec([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
		const a = randomSearch(spec, DATA, { iterations: 4, seed: 1 });
		const b = randomSearch(spec, DATA, { iterations: 4, seed: 999 });
		// Not a hard requirement, but for this grid the sampled override sets differ.
		expect(comboShape(a)).not.toEqual(comboShape(b));
	});

	it('respects the iterations cap: ran === min(iterations, gridSize)', () => {
		const spec = sweepSpec([2, 3, 4, 5, 6]); // gridSize = 5
		const under = randomSearch(spec, DATA, { iterations: 3, seed: 7 });
		expect(under.ran).toBe(3);
		expect(under.totalCombos).toBe(5);

		const over = randomSearch(spec, DATA, { iterations: 50, seed: 7 });
		expect(over.ran).toBe(5);
		expect(over.totalCombos).toBe(5);
	});

	it('samples without replacement (no duplicate override sets)', () => {
		const spec = sweepSpec([2, 3, 4, 5, 6, 7]);
		const r = randomSearch(spec, DATA, { iterations: 6, seed: 11 });
		const keys = r.combos.map((c) => c.overrides.map((o) => o.value).join(','));
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('is ranked best-first by the objective', () => {
		const spec = sweepSpec([2, 3, 4, 5, 6, 7, 8]);
		const obj: Objective = objectives.totalReturn;
		const r = randomSearch(spec, DATA, { iterations: 7, seed: 3, objective: obj });
		for (let i = 1; i < r.combos.length; i++) {
			expect(r.combos[i - 1].totalReturn).toBeGreaterThanOrEqual(r.combos[i].totalReturn);
		}
		expect(r.best).toEqual(r.combos[0]);
	});

	it('handles a single-value grid without error', () => {
		const spec = sweepSpec([4]);
		const r = randomSearch(spec, DATA, { iterations: 10, seed: 5 });
		expect(r.totalCombos).toBe(1);
		expect(r.ran).toBe(1);
		expect(r.best).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// geneticSearch
// ---------------------------------------------------------------------------

describe('geneticSearch', () => {
	it('is deterministic for a fixed seed (deep-equal results)', () => {
		const spec = sweepSpec([2, 3, 4, 5, 6, 7, 8, 9, 10]);
		const a = geneticSearch(spec, DATA, { populationSize: 6, generations: 4, seed: 21 });
		const b = geneticSearch(spec, DATA, { populationSize: 6, generations: 4, seed: 21 });
		expect(a).toEqual(b);
	});

	it('best objective >= population mean objective', () => {
		const spec = sweepSpec([2, 3, 4, 5, 6, 7, 8, 9, 10]);
		const obj = objectives.totalReturn;
		const r = geneticSearch(spec, DATA, {
			populationSize: 6,
			generations: 3,
			seed: 8,
			objective: obj
		});
		expect(r.best).not.toBeNull();
		const scores = r.combos.map((c) => c.totalReturn);
		const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
		expect(r.best!.totalReturn).toBeGreaterThanOrEqual(mean - 1e-9);
	});

	it('memoizes: distinct evaluations never exceed the grid size', () => {
		const spec = sweepSpec([2, 3, 4]); // gridSize = 3
		const r = geneticSearch(spec, DATA, { populationSize: 8, generations: 5, seed: 2 });
		// Even with 8 * 6 = 48 genome slots, at most 3 distinct combos exist.
		expect(r.ran).toBeLessThanOrEqual(3);
		expect(r.totalCombos).toBe(3);
	});

	it('handles empty params (degenerate grid)', () => {
		const spec: OptimizationSpec = { base: baseSpec(), params: [] };
		const r = geneticSearch(spec, DATA, { populationSize: 4, generations: 2, seed: 1 });
		expect(r.totalCombos).toBe(1);
		expect(r.best).not.toBeNull();
		expect(r.best!.overrides).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Rigged fixture: one param value is clearly best
// ---------------------------------------------------------------------------

describe('rigged fixture — both searches surface the winning value', () => {
	// Two dips followed by sustained rallies. A fast SMA (period 2) crosses up
	// early and catches BOTH legs for a clear profit; slower SMAs lag and miss the
	// first leg (period 5) or never enter at all (periods 10/15/20 → flat 0).
	// So period=2 is the unambiguous grid maximum by total return.
	const DOUBLE_DIP = candles([
		100, 100, 100, 99, 97, 95, 97, 101, 106, 112, 118, 124, 122, 119, 116, 118, 122, 128, 135, 142,
		149, 156, 162, 167, 171, 174, 176, 177
	]);
	const trendData = { TEST: DOUBLE_DIP };
	const winningValue = 2;
	const grid = [2, 5, 10, 15, 20];

	it('the winning period really is the grid maximum by totalReturn', async () => {
		const { runBacktest } = await import('./engine');
		const { applyOverrides } = await import('./optimize');
		const spec = sweepSpec(grid);
		const all = enumerateCombos(spec.params);
		let bestVal = -Infinity;
		let bestPeriod = -1;
		for (const overrides of all) {
			const res = runBacktest(applyOverrides(spec.base, overrides), trendData);
			const tr = res.metrics.find((m) => m.id === 'totalReturn')!.value;
			if (tr > bestVal) {
				bestVal = tr;
				bestPeriod = overrides[0].value;
			}
		}
		// Sanity: the rigging holds and the winner is profitable.
		expect(bestPeriod).toBe(winningValue);
		expect(bestVal).toBeGreaterThan(0);
	});

	it('randomSearch surfaces the winning value in best (full sweep)', () => {
		const spec = sweepSpec(grid);
		const r = randomSearch(spec, trendData, { iterations: grid.length, seed: 4 });
		expect(r.best!.overrides[0].value).toBe(winningValue);
	});

	it('geneticSearch surfaces the winning value in best', () => {
		const spec = sweepSpec(grid);
		const r = geneticSearch(spec, trendData, { populationSize: 6, generations: 5, seed: 4 });
		expect(r.best!.overrides[0].value).toBe(winningValue);
	});
});
