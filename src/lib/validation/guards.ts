/**
 * Runtime type guards for the discriminated unions. These narrow values for
 * the UI (which renders different editors per variant) and for the engine.
 */

import type { ConditionGroup, ConditionLeaf, Operand, ParamSchema, RuleNode } from '$lib/types';

export function isGroup(node: RuleNode): node is ConditionGroup {
	return node.kind === 'group';
}

export function isLeaf(node: RuleNode): node is ConditionLeaf {
	return node.kind !== 'group';
}

export function isBinaryLeaf(
	leaf: ConditionLeaf
): leaf is Extract<ConditionLeaf, { kind: 'binary' }> {
	return leaf.kind === 'binary';
}

export function isUnaryLeaf(
	leaf: ConditionLeaf
): leaf is Extract<ConditionLeaf, { kind: 'unary' }> {
	return leaf.kind === 'unary';
}

export function isRangeLeaf(
	leaf: ConditionLeaf
): leaf is Extract<ConditionLeaf, { kind: 'range' }> {
	return leaf.kind === 'range';
}

export function isIndicatorOperand(
	operand: Operand
): operand is Extract<Operand, { kind: 'indicator' }> {
	return operand.kind === 'indicator';
}

export function isPriceOperand(operand: Operand): operand is Extract<Operand, { kind: 'price' }> {
	return operand.kind === 'price';
}

export function isConstantOperand(
	operand: Operand
): operand is Extract<Operand, { kind: 'constant' }> {
	return operand.kind === 'constant';
}

export function isNumericParam(
	param: ParamSchema
): param is Extract<ParamSchema, { kind: 'int' | 'float' }> {
	return param.kind === 'int' || param.kind === 'float';
}

export function isEnumParam(param: ParamSchema): param is Extract<ParamSchema, { kind: 'enum' }> {
	return param.kind === 'enum';
}

export function isBoolParam(param: ParamSchema): param is Extract<ParamSchema, { kind: 'bool' }> {
	return param.kind === 'bool';
}
