/**
 * Factories for constructing valid spec fragments. Centralising these keeps the
 * store, the builder UI and the tests in agreement about what a "new" anything
 * looks like, and guarantees every constructed value satisfies the contract.
 */

import type {
	BinaryOperator,
	ConditionGroup,
	ConditionLeaf,
	Execution,
	IndicatorCapability,
	IndicatorInstance,
	LeafKind,
	Operand,
	OperandKind,
	ParamSchema,
	ParamValue,
	PersistenceOperator,
	RangeOperator,
	Risk,
	StrategySpec,
	UnaryOperator,
	Universe
} from '$lib/types';
import { SPEC_SCHEMA_VERSION } from '$lib/types';
import { newIndicatorId, newNodeId } from '$lib/utils/id';

export function emptyGroup(logic: 'AND' | 'OR' = 'AND'): ConditionGroup {
	return { kind: 'group', id: newNodeId(), logic, children: [] };
}

/** Build a params map from a capability's parameter defaults. */
export function defaultParams(cap: IndicatorCapability): Record<string, ParamValue> {
	const out: Record<string, ParamValue> = {};
	for (const p of cap.params) out[p.name] = (p as ParamSchema).default;
	return out;
}

export function createIndicatorInstance(cap: IndicatorCapability): IndicatorInstance {
	return {
		id: newIndicatorId(),
		type: cap.type,
		params: defaultParams(cap),
		priceSource: cap.defaultPriceSource
	};
}

/** First output component of a capability (`'value'` for single-output). */
export function defaultComponent(cap: IndicatorCapability): string {
	return cap.components[0] ?? 'value';
}

/** A sensible default operand of the requested kind. */
export function defaultOperand(kind: OperandKind, ref?: string, component?: string): Operand {
	switch (kind) {
		case 'indicator':
			return { kind: 'indicator', ref: ref ?? '', component, offset: 0 };
		case 'price':
			return { kind: 'price', field: 'close', offset: 0 };
		case 'constant':
			return { kind: 'constant', value: 0 };
		case 'aggregate':
			return {
				kind: 'aggregate',
				fn: 'highest',
				source: defaultOperand('price'),
				window: 20,
				offset: 0
			};
	}
}

export function createBinaryLeaf(
	left: Operand = defaultOperand('price'),
	op: BinaryOperator = 'crossover',
	right: Operand = defaultOperand('constant')
): ConditionLeaf {
	return { kind: 'binary', id: newNodeId(), left, op, right };
}

export function createUnaryLeaf(
	operand: Operand = defaultOperand('price'),
	op: UnaryOperator = 'rising',
	lookback = 1
): ConditionLeaf {
	return { kind: 'unary', id: newNodeId(), operand, op, lookback };
}

export function createRangeLeaf(
	operand: Operand = defaultOperand('price'),
	op: RangeOperator = 'insideRange',
	lower: Operand = defaultOperand('constant'),
	upper: Operand = defaultOperand('constant')
): ConditionLeaf {
	return { kind: 'range', id: newNodeId(), operand, op, lower, upper };
}

export function createPersistenceLeaf(
	operand: Operand = defaultOperand('price'),
	op: PersistenceOperator = 'gt',
	threshold: Operand = defaultOperand('constant'),
	bars = 3
): ConditionLeaf {
	return { kind: 'persistence', id: newNodeId(), operand, op, threshold, bars };
}

export function createSequenceLeaf(
	first: ConditionLeaf = createBinaryLeaf(),
	second: ConditionLeaf = createBinaryLeaf(),
	withinBars = 5
): ConditionLeaf {
	return { kind: 'sequence', id: newNodeId(), first, second, withinBars };
}

export function createLeaf(kind: LeafKind): ConditionLeaf {
	switch (kind) {
		case 'binary':
			return createBinaryLeaf();
		case 'unary':
			return createUnaryLeaf();
		case 'range':
			return createRangeLeaf();
		case 'persistence':
			return createPersistenceLeaf();
		case 'sequence':
			return createSequenceLeaf();
	}
}

export function defaultUniverse(): Universe {
	const today = new Date();
	const from = new Date(today);
	from.setFullYear(from.getFullYear() - 3);
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	return {
		tickers: [],
		timeframe: '1d',
		dateRange: { from: iso(from), to: iso(today) },
		session: { kind: 'RTH' }
	};
}

export function defaultRisk(): Risk {
	return {
		initialCapital: 100_000,
		positionSizing: { mode: 'percentEquity', percent: 10 },
		stopLoss: { mode: 'none' },
		takeProfit: { mode: 'none' },
		trailingStop: { mode: 'none' },
		maxConcurrentPositions: 1,
		pyramiding: 0,
		commission: { mode: 'none' },
		slippage: { mode: 'none' }
	};
}

export function defaultExecution(): Execution {
	// maxBarVolumePct omitted on purpose: uncapped fills by default (§2.3).
	return { fillOn: 'nextOpen', orderType: 'market' };
}

export function createDefaultSpec(name = 'Untitled strategy'): StrategySpec {
	return {
		schemaVersion: SPEC_SCHEMA_VERSION,
		name,
		universe: defaultUniverse(),
		indicators: [],
		rules: {
			longEntry: emptyGroup('AND'),
			longExit: emptyGroup('OR'),
			shortEntry: emptyGroup('AND'),
			shortExit: emptyGroup('OR')
		},
		risk: defaultRisk(),
		execution: defaultExecution()
	};
}

/** Human label for an indicator instance (uses override, else type + key params). */
export function indicatorLabel(
	instance: IndicatorInstance,
	cap: IndicatorCapability | undefined
): string {
	if (instance.label && instance.label.trim()) return instance.label.trim();
	const base = cap?.label ?? instance.type.toUpperCase();
	const primary = cap?.params[0];
	if (primary && instance.params[primary.name] !== undefined) {
		return `${cap?.type.toUpperCase() ?? instance.type.toUpperCase()} ${instance.params[primary.name]}`;
	}
	return base;
}
