import { describe, it, expect } from 'vitest';
import type {
	BinaryOperator,
	Candle,
	ConditionGroup,
	ConditionLeaf,
	Operand,
	PriceField,
	StrategySpec,
	Trade
} from '$lib/types';
import { runBacktest } from './engine';
import {
	detectLookahead,
	perturbAfter,
	runLeakGate,
	assertNoLookahead,
	type TradeRunner
} from './leak-gate';

// ---------------------------------------------------------------------------
// Fixtures (mirror engine.spec.ts conventions)
// ---------------------------------------------------------------------------

function candles(closes: number[]): Candle[] {
	return closes.map((c, i) => {
		const o = i === 0 ? c : closes[i - 1];
		const hi = Math.max(o, c) + 0.5;
		const lo = Math.min(o, c) - 0.5;
		return { t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(), o, h: hi, l: lo, c, v: 1000 };
	});
}

function group(logic: 'AND' | 'OR', children: (ConditionLeaf | ConditionGroup)[]): ConditionGroup {
	return { kind: 'group', id: `g_${Math.random().toString(36).slice(2)}`, logic, children };
}
const emptyGroup = (): ConditionGroup => group('AND', []);
function binary(left: Operand, op: BinaryOperator, right: Operand): ConditionLeaf {
	return { kind: 'binary', id: `l_${Math.random().toString(36).slice(2)}`, left, op, right };
}
const price = (field: PriceField, offset = 0): Operand => ({ kind: 'price', field, offset });
const constant = (value: number): Operand => ({ kind: 'constant', value });

function baseSpec(overrides: Partial<StrategySpec> = {}): StrategySpec {
	return {
		schemaVersion: 1,
		name: 'LeakGate',
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

/** A strategy that trades frequently, so the gate compares many settled trades. */
function zigzagSpec(): StrategySpec {
	return baseSpec({
		rules: {
			longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
			longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
			shortEntry: emptyGroup(),
			shortExit: emptyGroup()
		}
	});
}

/** Closes that oscillate across 105 repeatedly → many round-trip trades. */
function zigzagCloses(n: number): number[] {
	return Array.from({ length: n }, (_, i) => 105 + Math.sin(i / 2) * 7);
}

// ---------------------------------------------------------------------------
// 1. The real engine must PASS the future-invariance gate.
// ---------------------------------------------------------------------------

describe('LEAK GATE — the real engine is future-invariant', () => {
	it('no settled trade changes when the future is corrupted', () => {
		const spec = zigzagSpec();
		const data = candles(zigzagCloses(60));
		const runner: TradeRunner = (c) => runBacktest(spec, { TEST: c }).trades;

		const report = detectLookahead(runner, data);

		expect(report.leaked).toBe(false);
		expect(report.cutsChecked).toBeGreaterThan(0);
		// The test is only meaningful if it actually compared real settled trades.
		expect(report.tradesCompared).toBeGreaterThan(0);
		expect(report.evidence).toHaveLength(0);
	});

	it('runLeakGate passes across multiple tickers and assertNoLookahead does not throw', () => {
		const spec = baseSpec({
			universe: { ...baseSpec().universe, tickers: ['AAA', 'BBB'] },
			rules: zigzagSpec().rules
		});
		const data = {
			AAA: candles(zigzagCloses(50)),
			BBB: candles(zigzagCloses(50).map((c) => c + 3))
		};
		const report = runLeakGate(spec, data);
		expect(report.leaked).toBe(false);
		expect(() => assertNoLookahead(spec, data)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// 2. The gate must CATCH a planted leak. If this ever passes, the harness is
//    broken and nothing downstream can be trusted (spec §0 / LEAK GATE).
// ---------------------------------------------------------------------------

describe('LEAK GATE — catches a planted future-peeking strategy', () => {
	/**
	 * A deliberately-cheating runner: every trade's EXIT PRICE is taken from a
	 * bar H steps in the FUTURE relative to its exit. A past trade therefore
	 * encodes information it could not have known — the canonical leak.
	 */
	function oracleRunner(H: number): TradeRunner {
		return (c: Candle[]): Trade[] => {
			const out: Trade[] = [];
			let seq = 0;
			for (let i = 0; i + H < c.length; i++) {
				const entry = c[i];
				const exit = c[i + 1];
				const future = c[i + H]; // LEAK: a future bar baked into a settled trade
				out.push({
					id: `leak_${++seq}`,
					ticker: 'TEST',
					side: 'long',
					entryTime: entry.t,
					entryPrice: entry.o,
					exitTime: exit.t, // settles at bar index i+1
					exitPrice: future.c, // ← depends on the future
					qty: 1,
					stopPrice: null,
					targetPrice: null,
					pnl: future.c - entry.o,
					pnlPct: 0,
					rMultiple: NaN,
					cumulativePnl: 0,
					mae: 0,
					mfe: 0,
					exitReason: 'signalExit',
					barsHeld: 1
				});
			}
			return out;
		};
	}

	it('flags the leak with concrete evidence', () => {
		const data = candles(zigzagCloses(60));
		const report = detectLookahead(oracleRunner(4), data);

		expect(report.leaked).toBe(true);
		expect(report.evidence.length).toBeGreaterThan(0);
		// Evidence pinpoints a cut and shows the divergence.
		const first = report.evidence[0];
		expect(first.cutIndex).toBeGreaterThanOrEqual(0);
		expect(first.baseline).not.toBe(first.perturbed);
	});

	it('a clean (non-peeking) version of the same shape passes', () => {
		// Identical structure but the exit price is the ACTUAL exit bar's close.
		const cleanRunner: TradeRunner = (c) => {
			const out: Trade[] = [];
			let seq = 0;
			for (let i = 0; i + 1 < c.length; i++) {
				const entry = c[i];
				const exit = c[i + 1];
				out.push({
					id: `ok_${++seq}`,
					ticker: 'TEST',
					side: 'long',
					entryTime: entry.t,
					entryPrice: entry.o,
					exitTime: exit.t,
					exitPrice: exit.c, // only the settled bar — no future
					qty: 1,
					stopPrice: null,
					targetPrice: null,
					pnl: exit.c - entry.o,
					pnlPct: 0,
					rMultiple: NaN,
					cumulativePnl: 0,
					mae: 0,
					mfe: 0,
					exitReason: 'signalExit',
					barsHeld: 1
				});
			}
			return out;
		};
		const report = detectLookahead(cleanRunner, candles(zigzagCloses(60)));
		expect(report.leaked).toBe(false);
		expect(report.tradesCompared).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// 3. perturbAfter corrupts only the future and preserves timestamps.
// ---------------------------------------------------------------------------

describe('perturbAfter', () => {
	it('leaves bars at/before the cut byte-identical and preserves all timestamps', () => {
		const data = candles([100, 101, 102, 103, 104, 105, 106]);
		const cut = 3;
		const out = perturbAfter(data, cut);

		expect(out).toHaveLength(data.length);
		for (let i = 0; i <= cut; i++) expect(out[i]).toEqual(data[i]);
		for (let i = cut + 1; i < data.length; i++) {
			expect(out[i].o).not.toBe(data[i].o); // OHLCV corrupted
			expect(out[i].t).toBe(data[i].t); // timestamp preserved
			expect(out[i].h).toBeGreaterThanOrEqual(Math.max(out[i].o, out[i].c)); // valid candle
			expect(out[i].l).toBeLessThanOrEqual(Math.min(out[i].o, out[i].c));
		}
	});
});

// ---------------------------------------------------------------------------
// 4. P2 CHECKPOINT — prove a single known trade fills at NEXT BAR OPEN,
//    never the signal bar's close (spec §2.2).
// ---------------------------------------------------------------------------

describe('CHECKPOINT — fill is next-bar-open, not signal-close', () => {
	it('a crossover signal fills at the following bar open across a price gap', () => {
		const t = (i: number) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString();
		// idx1 close 104 (<=105), idx2 close 106 (>105) → crossover AT idx2.
		// idx3 GAPS UP: open 120 (distinct from idx2 close 106) → the fill must be 120.
		const data: Candle[] = [
			{ t: t(0), o: 100, h: 100.5, l: 99.5, c: 100, v: 1000 },
			{ t: t(1), o: 100, h: 104.5, l: 99.5, c: 104, v: 1000 },
			{ t: t(2), o: 104, h: 106.5, l: 103.5, c: 106, v: 1000 }, // signal bar
			{ t: t(3), o: 120, h: 122.0, l: 119.5, c: 121, v: 1000 }, // gap-up fill bar
			{ t: t(4), o: 121, h: 123.0, l: 120.5, c: 122, v: 1000 }
		];
		const spec = baseSpec({
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});

		const result = runBacktest(spec, { TEST: data });

		expect(result.trades).toHaveLength(1);
		const trade = result.trades[0];
		// THE proof: entry price is the NEXT bar's open (120)…
		expect(trade.entryPrice).toBe(120);
		expect(trade.entryTime).toBe(t(3));
		// …and explicitly NOT the signal bar's close (106) or open (104).
		expect(trade.entryPrice).not.toBe(106);
		expect(trade.entryPrice).not.toBe(104);
		// Rides to end of data, closing at the last bar's close.
		expect(trade.exitReason).toBe('endOfData');
		expect(trade.exitPrice).toBe(122);
	});
});
