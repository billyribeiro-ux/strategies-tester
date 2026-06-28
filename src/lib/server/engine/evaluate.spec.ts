import { describe, it, expect } from 'vitest';
import type { Candle, ConditionLeaf, Operand } from '$lib/types';
import { evaluateLeaf, resolveOperand, type EvalContext } from './evaluate';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a candle where every field equals the given close (simple to reason about). */
function flatCandle(c: number): Candle {
	return { t: `2024-01-${String(c).padStart(2, '0')}T00:00:00Z`, o: c, h: c, l: c, c, v: c };
}

/** Build a context from explicit OHLCV closes (high/low overridable). */
function ctxFromCloses(closes: number[]): EvalContext {
	return {
		candles: closes.map((c, i) => ({
			t: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
			o: c,
			h: c,
			l: c,
			c,
			v: c
		})),
		indicators: {}
	};
}

function ctxFromOHLC(
	rows: Array<{ o: number; h: number; l: number; c: number; v?: number }>
): EvalContext {
	return {
		candles: rows.map((r, i) => ({
			t: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
			o: r.o,
			h: r.h,
			l: r.l,
			c: r.c,
			v: r.v ?? 0
		})),
		indicators: {}
	};
}

const closeOp = (offset = 0): Operand => ({ kind: 'price', field: 'close', offset });
const highOp = (offset = 0): Operand => ({ kind: 'price', field: 'high', offset });
const constOp = (value: number): Operand => ({ kind: 'constant', value });

let leafSeq = 0;
function id(): string {
	leafSeq++;
	return `leaf-${leafSeq}`;
}

// ---------------------------------------------------------------------------
// Aggregate operand
// ---------------------------------------------------------------------------

describe('aggregate operand', () => {
	const ctx = ctxFromCloses([10, 12, 8, 20, 15, 5]); // indices 0..5

	it('highest over a trailing window', () => {
		const agg: Operand = {
			kind: 'aggregate',
			fn: 'highest',
			source: closeOp(),
			window: 3,
			offset: 0
		};
		// at i=4: bars 2,3,4 → closes 8,20,15 → highest 20
		expect(resolveOperand(agg, ctx, 4)).toBe(20);
		// at i=5: bars 3,4,5 → 20,15,5 → 20
		expect(resolveOperand(agg, ctx, 5)).toBe(20);
	});

	it('lowest over a trailing window', () => {
		const agg: Operand = {
			kind: 'aggregate',
			fn: 'lowest',
			source: closeOp(),
			window: 3,
			offset: 0
		};
		// at i=4: 8,20,15 → 8
		expect(resolveOperand(agg, ctx, 4)).toBe(8);
		// at i=5: 20,15,5 → 5
		expect(resolveOperand(agg, ctx, 5)).toBe(5);
	});

	it('mean over a trailing window', () => {
		const agg: Operand = {
			kind: 'aggregate',
			fn: 'mean',
			source: closeOp(),
			window: 4,
			offset: 0
		};
		// at i=3: 10,12,8,20 → 50/4 = 12.5
		expect(resolveOperand(agg, ctx, 3)).toBe(12.5);
	});

	it('sum over a trailing window', () => {
		const agg: Operand = {
			kind: 'aggregate',
			fn: 'sum',
			source: closeOp(),
			window: 3,
			offset: 0
		};
		// at i=2: 10,12,8 → 30
		expect(resolveOperand(agg, ctx, 2)).toBe(30);
	});

	it('honours offset (window ends `offset` bars ago)', () => {
		const agg: Operand = {
			kind: 'aggregate',
			fn: 'highest',
			source: closeOp(),
			window: 2,
			offset: 1
		};
		// at i=5, offset 1 → window ends at bar 4: bars 3,4 → 20,15 → 20
		expect(resolveOperand(agg, ctx, 5)).toBe(20);
	});

	it('returns NaN when the window extends before bar 0 (out of range)', () => {
		const agg: Operand = {
			kind: 'aggregate',
			fn: 'highest',
			source: closeOp(),
			window: 4,
			offset: 0
		};
		// at i=2: window would be bars -1,0,1,2 → start < 0 → NaN
		expect(resolveOperand(agg, ctx, 2)).toBeNaN();
	});

	it('returns NaN if the source is NaN anywhere in the window', () => {
		// missing-indicator reference resolves to NaN
		const agg: Operand = {
			kind: 'aggregate',
			fn: 'sum',
			source: { kind: 'indicator', ref: 'nope', offset: 0 },
			window: 2,
			offset: 0
		};
		expect(resolveOperand(agg, ctx, 5)).toBeNaN();
	});

	it('drives a binary leaf: close > highest high of last N (breakout)', () => {
		// highs: 10,12,8,20,15,5 ; close at i breaks above the prior 3-bar high
		const c = ctxFromOHLC([
			{ o: 10, h: 10, l: 9, c: 10 },
			{ o: 12, h: 12, l: 11, c: 12 },
			{ o: 8, h: 8, l: 7, c: 8 },
			{ o: 13, h: 13, l: 12, c: 25 }, // close 25 > highest high of bars 0..2 (=12)
			{ o: 15, h: 15, l: 14, c: 15 }
		]);
		const leaf: ConditionLeaf = {
			kind: 'binary',
			id: id(),
			left: closeOp(0),
			op: 'gt',
			right: {
				kind: 'aggregate',
				fn: 'highest',
				source: highOp(1), // highest of the PRIOR bars (offset 1)
				window: 3,
				offset: 0
			}
		};
		expect(evaluateLeaf(leaf, c, 3)).toBe(true);
		// at i=4: highest high of prior 3 bars (1,2,3) = max(12,8,13)=13; close 15 > 13 → true
		expect(evaluateLeaf(leaf, c, 4)).toBe(true);
		// add a non-breakout bar: close 12 not > highest high of bars 2,3,4 (=15)
		const c2 = ctxFromOHLC([
			{ o: 10, h: 10, l: 9, c: 10 },
			{ o: 12, h: 12, l: 11, c: 12 },
			{ o: 8, h: 8, l: 7, c: 8 },
			{ o: 13, h: 13, l: 12, c: 25 },
			{ o: 15, h: 15, l: 14, c: 15 },
			{ o: 12, h: 12, l: 11, c: 12 }
		]);
		expect(evaluateLeaf(leaf, c2, 5)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Persistence leaf
// ---------------------------------------------------------------------------

describe('persistence leaf', () => {
	const ctx = ctxFromCloses([5, 11, 12, 13, 9, 14, 15, 16]);

	function persist(
		op: 'gt' | 'gte' | 'lt' | 'lte',
		threshold: number,
		bars: number
	): ConditionLeaf {
		return {
			kind: 'persistence',
			id: id(),
			operand: closeOp(),
			op,
			threshold: constOp(threshold),
			bars
		};
	}

	it('true only when the streak length is met', () => {
		// closes > 10 at bars 1,2,3 (11,12,13). At i=3, last 3 bars all > 10 → true.
		expect(evaluateLeaf(persist('gt', 10, 3), ctx, 3)).toBe(true);
		// last 4 bars (0..3): bar 0 close 5 not > 10 → false
		expect(evaluateLeaf(persist('gt', 10, 4), ctx, 3)).toBe(false);
	});

	it('false when an interior bar breaks the streak', () => {
		// at i=5: bars 5,4 → 14,9. 9 not > 10 → false for bars=2
		expect(evaluateLeaf(persist('gt', 10, 2), ctx, 5)).toBe(false);
		// at i=7: bars 7,6,5 → 16,15,14 all > 10 → true for bars=3
		expect(evaluateLeaf(persist('gt', 10, 3), ctx, 7)).toBe(true);
	});

	it('respects gte / lt / lte', () => {
		const c = ctxFromCloses([10, 10, 10, 10]);
		expect(evaluateLeaf(persist('gte', 10, 4), c, 3)).toBe(true);
		expect(evaluateLeaf(persist('gt', 10, 4), c, 3)).toBe(false);
		expect(evaluateLeaf(persist('lte', 10, 4), c, 3)).toBe(true);
		expect(evaluateLeaf(persist('lt', 10, 4), c, 3)).toBe(false);
	});

	it('false when the streak reaches before bar 0 (out of range)', () => {
		// at i=1, bars=3 → earliest = -1 → false
		expect(evaluateLeaf(persist('gt', 0, 3), ctx, 1)).toBe(false);
	});

	it('false when an operand is NaN', () => {
		const leaf: ConditionLeaf = {
			kind: 'persistence',
			id: id(),
			operand: { kind: 'indicator', ref: 'missing', offset: 0 },
			op: 'gt',
			threshold: constOp(0),
			bars: 2
		};
		expect(evaluateLeaf(leaf, ctx, 5)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Sequence leaf
// ---------------------------------------------------------------------------

describe('sequence leaf', () => {
	// closes: dip below 10 at bar 1, then spike above 20 at bar 3
	const ctx = ctxFromCloses([15, 5, 12, 25, 18, 30]);

	const below10: ConditionLeaf = {
		kind: 'binary',
		id: 'a',
		left: closeOp(),
		op: 'lt',
		right: constOp(10)
	};
	const above20: ConditionLeaf = {
		kind: 'binary',
		id: 'b',
		left: closeOp(),
		op: 'gt',
		right: constOp(20)
	};

	function seq(withinBars: number): ConditionLeaf {
		return { kind: 'sequence', id: id(), first: below10, second: above20, withinBars };
	}

	it('true when first precedes second within the window', () => {
		// second (close>20) true at bar 3; first (close<10) true at bar 1, within 3 bars → true
		expect(evaluateLeaf(seq(3), ctx, 3)).toBe(true);
	});

	it('false when first is too far before second', () => {
		// at bar 3, withinBars=1 → only scans bar 2 (close 12, not <10) → false
		expect(evaluateLeaf(seq(1), ctx, 3)).toBe(false);
	});

	it('false when second is not true at i', () => {
		// at bar 2 (close 12) second is false → false regardless of first
		expect(evaluateLeaf(seq(5), ctx, 2)).toBe(false);
	});

	it('false on out-of-order (first only appears after second)', () => {
		// closes: spike first, dip later — order reversed
		const c = ctxFromCloses([25, 30, 5, 8, 12]);
		// second (>20) true only at bars 0,1; first (<10) at bars 2,3 — first never precedes second
		expect(evaluateLeaf(seq(5), c, 0)).toBe(false);
		expect(evaluateLeaf(seq(5), c, 1)).toBe(false);
	});

	it('scans only strictly before i (does not match first at i itself)', () => {
		// a single bar that satisfies both first and second cannot be a sequence
		const c = ctxFromCloses([5]);
		const both: ConditionLeaf = {
			kind: 'sequence',
			id: id(),
			first: { kind: 'binary', id: 'x', left: closeOp(), op: 'lt', right: constOp(10) },
			second: { kind: 'binary', id: 'y', left: closeOp(), op: 'lt', right: constOp(10) },
			withinBars: 5
		};
		expect(evaluateLeaf(both, c, 0)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// No look-ahead: evaluating at bar i must not depend on bars > i
// ---------------------------------------------------------------------------

describe('no look-ahead', () => {
	function mutateFuture(ctx: EvalContext, fromIndex: number): EvalContext {
		const candles = ctx.candles.map((c, i) => (i >= fromIndex ? flatCandle(999_999) : c));
		return { candles, indicators: ctx.indicators };
	}

	it('aggregate at i is unchanged when future bars are corrupted', () => {
		const ctx = ctxFromCloses([10, 12, 8, 20, 15, 5, 7, 9]);
		const agg: Operand = {
			kind: 'aggregate',
			fn: 'mean',
			source: closeOp(),
			window: 3,
			offset: 0
		};
		const i = 3;
		const before = resolveOperand(agg, ctx, i);
		const after = resolveOperand(agg, mutateFuture(ctx, i + 1), i);
		expect(after).toBe(before);
		expect(Number.isNaN(before)).toBe(false);
	});

	it('persistence leaf at i is unchanged when future bars are corrupted', () => {
		const ctx = ctxFromCloses([5, 11, 12, 13, 9, 14, 15, 16]);
		const leaf: ConditionLeaf = {
			kind: 'persistence',
			id: id(),
			operand: closeOp(),
			op: 'gt',
			threshold: constOp(10),
			bars: 3
		};
		const i = 3;
		const before = evaluateLeaf(leaf, ctx, i);
		const after = evaluateLeaf(leaf, mutateFuture(ctx, i + 1), i);
		expect(after).toBe(before);
		expect(before).toBe(true);
	});

	it('sequence leaf at i is unchanged when future bars are corrupted', () => {
		const ctx = ctxFromCloses([15, 5, 12, 25, 18, 30, 2, 40]);
		const leaf: ConditionLeaf = {
			kind: 'sequence',
			id: id(),
			first: { kind: 'binary', id: 'a', left: closeOp(), op: 'lt', right: constOp(10) },
			second: { kind: 'binary', id: 'b', left: closeOp(), op: 'gt', right: constOp(20) },
			withinBars: 3
		};
		const i = 3;
		const before = evaluateLeaf(leaf, ctx, i);
		const after = evaluateLeaf(leaf, mutateFuture(ctx, i + 1), i);
		expect(after).toBe(before);
		expect(before).toBe(true);
	});
});
