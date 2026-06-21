/**
 * Operator metadata: intrinsic arity and labels, plus helpers for the
 * type-aware rule builder. The set of operators OFFERED comes from the
 * capabilities endpoint; this module supplies the arity/label semantics the UI
 * needs to render the correct condition shape and to filter operators by the
 * chosen operand.
 */

import type {
	BinaryOperator,
	Operand,
	OperandKind,
	Operator,
	OperatorArity,
	RangeOperator,
	UnaryOperator
} from '$lib/types';
import {
	BINARY_OPERATORS,
	RANGE_OPERATORS,
	UNARY_OPERATORS
} from '$lib/types';

export interface OperatorMeta {
	id: Operator;
	label: string;
	arity: OperatorArity;
	description: string;
}

const META: Record<Operator, OperatorMeta> = {
	crossover: {
		id: 'crossover',
		label: 'crosses above',
		arity: 'binary',
		description: 'Left crosses from below to above right (this bar above, previous bar below).'
	},
	crossunder: {
		id: 'crossunder',
		label: 'crosses below',
		arity: 'binary',
		description: 'Left crosses from above to below right.'
	},
	gt: { id: 'gt', label: 'is greater than', arity: 'binary', description: 'Left > right.' },
	gte: {
		id: 'gte',
		label: 'is greater than or equal to',
		arity: 'binary',
		description: 'Left ≥ right.'
	},
	lt: { id: 'lt', label: 'is less than', arity: 'binary', description: 'Left < right.' },
	lte: {
		id: 'lte',
		label: 'is less than or equal to',
		arity: 'binary',
		description: 'Left ≤ right.'
	},
	eq: { id: 'eq', label: 'equals', arity: 'binary', description: 'Left = right.' },
	rising: {
		id: 'rising',
		label: 'is rising',
		arity: 'unary',
		description: 'Value increased over the lookback window.'
	},
	falling: {
		id: 'falling',
		label: 'is falling',
		arity: 'unary',
		description: 'Value decreased over the lookback window.'
	},
	insideRange: {
		id: 'insideRange',
		label: 'is inside range',
		arity: 'range',
		description: 'Value is between the lower and upper bounds (inclusive).'
	},
	outsideRange: {
		id: 'outsideRange',
		label: 'is outside range',
		arity: 'range',
		description: 'Value is below the lower bound or above the upper bound.'
	}
};

export function operatorMeta(op: Operator): OperatorMeta {
	return META[op];
}

export function operatorArity(op: Operator): OperatorArity {
	return META[op].arity;
}

export function operatorLabel(op: Operator): string {
	return META[op].label;
}

export function isBinaryOperator(op: Operator): op is BinaryOperator {
	return (BINARY_OPERATORS as readonly Operator[]).includes(op);
}
export function isUnaryOperator(op: Operator): op is UnaryOperator {
	return (UNARY_OPERATORS as readonly Operator[]).includes(op);
}
export function isRangeOperator(op: Operator): op is RangeOperator {
	return (RANGE_OPERATORS as readonly Operator[]).includes(op);
}

/**
 * A `constant` operand cannot itself be tested for direction; `rising`/`falling`
 * only make sense for series operands (indicator or price). Binary/range
 * operators accept any operand kind on the primary side.
 */
export function operatorAllowedForOperand(op: Operator, kind: OperandKind): boolean {
	if (operatorArity(op) === 'unary') return kind !== 'constant';
	return true;
}

/** Operators valid for a given primary operand, honouring the offered set. */
export function operatorsForOperand(operand: Operand, offered: Operator[]): Operator[] {
	return offered.filter((op) => operatorAllowedForOperand(op, operand.kind));
}
