/**
 * Per-bar condition evaluation. Given precomputed indicator series and the price
 * series for one ticker, evaluate any `ConditionGroup`/`ConditionLeaf` at a bar
 * index `i`, fully point-in-time: an operand at `offset` reads bar `i - offset`,
 * and crossover/unary operators reference the immediately prior bar — never the
 * future.
 *
 * Any operand that resolves to `NaN` (warm-up, out-of-range, missing reference)
 * makes its leaf evaluate to `false`. An empty group is `false` (no effect).
 */

import type { Candle, ConditionGroup, ConditionLeaf, Operand, RuleNode } from '$lib/types';
import { assertNever } from '$lib/utils/assert-never';
import { isGroup } from '$lib/validation/guards';
import { priceAt } from './series';

/** Resolved component series for one indicator instance, keyed by component. */
export type IndicatorSeriesMap = Record<string, number[]>;

/** Everything `evaluate` needs for one ticker. */
export interface EvalContext {
	candles: Candle[];
	/** indicator instance id → component → aligned series. */
	indicators: Record<string, IndicatorSeriesMap>;
}

/**
 * Resolve an operand to a number at bar `i`. Returns `NaN` for out-of-range
 * indices, missing references, or warm-up positions.
 */
export function resolveOperand(operand: Operand, ctx: EvalContext, i: number): number {
	switch (operand.kind) {
		case 'constant':
			return operand.value;
		case 'price': {
			const idx = i - operand.offset;
			if (idx < 0 || idx >= ctx.candles.length) return NaN;
			return priceAt(ctx.candles[idx], operand.field);
		}
		case 'indicator': {
			const idx = i - operand.offset;
			if (idx < 0) return NaN;
			const components = ctx.indicators[operand.ref];
			if (!components) return NaN;
			const series = components[operand.component ?? 'value'];
			if (!series || idx >= series.length) return NaN;
			const v = series[idx];
			return typeof v === 'number' ? v : NaN;
		}
		default:
			return assertNever(operand, 'Unknown operand kind');
	}
}

/** Evaluate a group: AND = all true, OR = any true, empty = false. */
export function evaluateGroup(group: ConditionGroup, ctx: EvalContext, i: number): boolean {
	if (group.children.length === 0) return false;
	if (group.logic === 'AND') {
		return group.children.every((child) => evaluateNode(child, ctx, i));
	}
	return group.children.some((child) => evaluateNode(child, ctx, i));
}

function evaluateNode(node: RuleNode, ctx: EvalContext, i: number): boolean {
	return isGroup(node) ? evaluateGroup(node, ctx, i) : evaluateLeaf(node, ctx, i);
}

/** Evaluate a single condition leaf at bar `i`. */
export function evaluateLeaf(leaf: ConditionLeaf, ctx: EvalContext, i: number): boolean {
	switch (leaf.kind) {
		case 'binary': {
			const l = resolveOperand(leaf.left, ctx, i);
			const r = resolveOperand(leaf.right, ctx, i);
			if (Number.isNaN(l) || Number.isNaN(r)) return false;
			switch (leaf.op) {
				case 'crossover': {
					const lp = resolveOperand(leaf.left, ctx, i - 1);
					const rp = resolveOperand(leaf.right, ctx, i - 1);
					if (Number.isNaN(lp) || Number.isNaN(rp)) return false;
					return l > r && lp <= rp;
				}
				case 'crossunder': {
					const lp = resolveOperand(leaf.left, ctx, i - 1);
					const rp = resolveOperand(leaf.right, ctx, i - 1);
					if (Number.isNaN(lp) || Number.isNaN(rp)) return false;
					return l < r && lp >= rp;
				}
				case 'gt':
					return l > r;
				case 'gte':
					return l >= r;
				case 'lt':
					return l < r;
				case 'lte':
					return l <= r;
				case 'eq':
					return l === r;
				default:
					return false; // unreachable: BinaryOperator is exhaustive above
			}
		}
		case 'unary': {
			const v = resolveOperand(leaf.operand, ctx, i);
			const past = resolveOperand(leaf.operand, ctx, i - leaf.lookback);
			if (Number.isNaN(v) || Number.isNaN(past)) return false;
			switch (leaf.op) {
				case 'rising':
					return v > past;
				case 'falling':
					return v < past;
				default:
					return false; // unreachable: UnaryOperator is exhaustive above
			}
		}
		case 'range': {
			const v = resolveOperand(leaf.operand, ctx, i);
			const lo = resolveOperand(leaf.lower, ctx, i);
			const up = resolveOperand(leaf.upper, ctx, i);
			if (Number.isNaN(v) || Number.isNaN(lo) || Number.isNaN(up)) return false;
			switch (leaf.op) {
				case 'insideRange':
					return v >= lo && v <= up;
				case 'outsideRange':
					return v < lo || v > up;
				default:
					return false; // unreachable: RangeOperator is exhaustive above
			}
		}
		default:
			return assertNever(leaf, 'Unknown leaf kind');
	}
}
