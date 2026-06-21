/**
 * Zod schemas mirroring the StrategySpec contract — the RUNTIME boundary.
 *
 * Used to `parse` specs arriving at `POST /api/backtest` and to `parse` JSON on
 * import, so malformed payloads are rejected with structured errors before they
 * reach the engine or the store. Compile-time safety is provided by the
 * discriminated unions in `$lib/types`; this adds runtime safety.
 */

import { z } from 'zod';
import type { ConditionGroup, RuleNode, StrategySpec } from '$lib/types';

const priceField = z.enum(['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4']);
const offset = z.number().int().min(0);

const operandSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('indicator'),
		ref: z.string().min(1),
		component: z.string().optional(),
		offset
	}),
	z.object({ kind: z.literal('price'), field: priceField, offset }),
	z.object({ kind: z.literal('constant'), value: z.number().finite() })
]);

const binaryOperator = z.enum(['crossover', 'crossunder', 'gt', 'gte', 'lt', 'lte', 'eq']);
const unaryOperator = z.enum(['rising', 'falling']);
const rangeOperator = z.enum(['insideRange', 'outsideRange']);

const conditionLeafSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('binary'),
		id: z.string(),
		left: operandSchema,
		op: binaryOperator,
		right: operandSchema
	}),
	z.object({
		kind: z.literal('unary'),
		id: z.string(),
		operand: operandSchema,
		op: unaryOperator,
		lookback: z.number().int().min(1)
	}),
	z.object({
		kind: z.literal('range'),
		id: z.string(),
		operand: operandSchema,
		op: rangeOperator,
		lower: operandSchema,
		upper: operandSchema
	})
]);

const conditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
	z.object({
		kind: z.literal('group'),
		id: z.string(),
		logic: z.enum(['AND', 'OR']),
		children: z.array(ruleNodeSchema)
	})
);

const ruleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
	z.union([conditionGroupSchema, conditionLeafSchema])
);

const paramValue = z.union([z.number(), z.string(), z.boolean()]);

const indicatorInstanceSchema = z.object({
	id: z.string().min(1),
	type: z.string().min(1),
	params: z.record(z.string(), paramValue),
	priceSource: priceField,
	label: z.string().optional()
});

const sessionSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('RTH') }),
	z.object({ kind: z.literal('ETH') }),
	z.object({
		kind: z.literal('custom'),
		startHM: z.string().regex(/^\d{2}:\d{2}$/),
		endHM: z.string().regex(/^\d{2}:\d{2}$/),
		tz: z.string().min(1)
	})
]);

const universeSchema = z.object({
	tickers: z.array(z.string()),
	timeframe: z.string().min(1),
	dateRange: z.object({ from: z.string(), to: z.string() }),
	session: sessionSchema
});

const positionSizingSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('fixedShares'), shares: z.number().positive() }),
	z.object({ mode: z.literal('fixedNotional'), notional: z.number().positive() }),
	z.object({ mode: z.literal('percentEquity'), percent: z.number().positive() }),
	z.object({ mode: z.literal('riskBased'), riskPercent: z.number().positive() })
]);

const stopLossSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('none') }),
	z.object({ mode: z.literal('percent'), percent: z.number().positive() }),
	z.object({ mode: z.literal('atr'), atrRef: z.string().min(1), multiple: z.number().positive() }),
	z.object({ mode: z.literal('points'), points: z.number().positive() })
]);

const takeProfitSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('none') }),
	z.object({ mode: z.literal('percent'), percent: z.number().positive() }),
	z.object({ mode: z.literal('rMultiple'), r: z.number().positive() }),
	z.object({ mode: z.literal('atr'), atrRef: z.string().min(1), multiple: z.number().positive() })
]);

const trailingStopSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('none') }),
	z.object({ mode: z.literal('percent'), percent: z.number().positive() }),
	z.object({ mode: z.literal('atr'), atrRef: z.string().min(1), multiple: z.number().positive() })
]);

const commissionSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('none') }),
	z.object({ mode: z.literal('perShare'), perShare: z.number().min(0) }),
	z.object({ mode: z.literal('perTrade'), perTrade: z.number().min(0) }),
	z.object({ mode: z.literal('percent'), percent: z.number().min(0) })
]);

const slippageSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('none') }),
	z.object({ mode: z.literal('percent'), percent: z.number().min(0) }),
	z.object({ mode: z.literal('ticks'), ticks: z.number().min(0), tickSize: z.number().positive() })
]);

const riskSchema = z.object({
	initialCapital: z.number().positive(),
	positionSizing: positionSizingSchema,
	stopLoss: stopLossSchema,
	takeProfit: takeProfitSchema,
	trailingStop: trailingStopSchema,
	maxConcurrentPositions: z.number().int().min(1),
	pyramiding: z.number().int().min(0),
	commission: commissionSchema,
	slippage: slippageSchema
});

const executionSchema = z.object({
	fillOn: z.enum(['nextOpen', 'close', 'signalPrice']),
	orderType: z.enum(['market', 'limit', 'stop'])
});

export const strategySpecSchema: z.ZodType<StrategySpec> = z.object({
	schemaVersion: z.number().int(),
	name: z.string(),
	universe: universeSchema,
	indicators: z.array(indicatorInstanceSchema),
	rules: z.object({
		longEntry: conditionGroupSchema,
		longExit: conditionGroupSchema,
		shortEntry: conditionGroupSchema,
		shortExit: conditionGroupSchema
	}),
	risk: riskSchema,
	execution: executionSchema
});

export type SpecParseResult =
	| { success: true; data: StrategySpec }
	| { success: false; error: z.ZodError };

/** Structurally validate an unknown value as a StrategySpec. */
export function parseSpec(value: unknown): SpecParseResult {
	const result = strategySpecSchema.safeParse(value);
	return result.success
		? { success: true, data: result.data }
		: { success: false, error: result.error };
}
