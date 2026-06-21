/**
 * StrategySpec — THE CONTRACT.
 *
 * Every control in the UI is an editor for one serializable `StrategySpec`.
 * The whole app is built around these types, which are imported verbatim by
 * both the client and the server (the backtest engine), so there is zero
 * contract drift. Exhaustive discriminated unions make an invalid spec
 * unconstructible at compile time; operator arity is encoded in the shape of
 * `ConditionLeaf`.
 *
 * Ids that come from the schema-driven capabilities endpoint (indicator types,
 * timeframes, operators) are kept as string aliases — never hardcode their
 * members anywhere in the UI; read them from `GET /api/capabilities`.
 */

/** A timeframe id, e.g. `'1m' | '5m' | '1h' | '1d'`. Source: capabilities. */
export type TimeframeId = string;

/** An indicator type id, e.g. `'ema' | 'rsi' | 'macd'`. Source: capabilities. */
export type IndicatorType = string;

/** Price fields usable as operands and indicator sources. */
export type PriceField = 'open' | 'high' | 'low' | 'close' | 'volume' | 'hl2' | 'hlc3' | 'ohlc4';

export const PRICE_FIELDS: readonly PriceField[] = [
	'open',
	'high',
	'low',
	'close',
	'volume',
	'hl2',
	'hlc3',
	'ohlc4'
] as const;

// ---------------------------------------------------------------------------
// Universe
// ---------------------------------------------------------------------------

/** Trading session the backtest should consider. */
export type SessionSpec =
	| { kind: 'RTH' } // regular trading hours
	| { kind: 'ETH' } // extended (incl. pre/post market)
	| { kind: 'custom'; startHM: string; endHM: string; tz: string }; // 'HH:mm', IANA tz

/** Inclusive ISO date range (`yyyy-mm-dd`). */
export interface DateRange {
	from: string;
	to: string;
}

export interface Universe {
	tickers: string[];
	timeframe: TimeframeId;
	dateRange: DateRange;
	session: SessionSpec;
}

// ---------------------------------------------------------------------------
// Indicator instances — declared once, referenced by id everywhere
// ---------------------------------------------------------------------------

export type ParamValue = number | string | boolean;

export interface IndicatorInstance {
	/** Stable unique id; referenced from operands and risk stops. */
	id: string;
	/** Indicator type from the capabilities catalog. */
	type: IndicatorType;
	/** Parameter map validated against the capability's `ParamSchema[]`. */
	params: Record<string, ParamValue>;
	/** Price series the indicator is computed from. */
	priceSource: PriceField;
	/** Optional user-facing label override (defaults to a derived label). */
	label?: string;
}

// ---------------------------------------------------------------------------
// Operands (discriminated union). `offset` = N bars ago (0 = current bar).
// ---------------------------------------------------------------------------

export type Operand =
	| { kind: 'indicator'; ref: string; component?: string; offset: number }
	| { kind: 'price'; field: PriceField; offset: number }
	| { kind: 'constant'; value: number };

export type OperandKind = Operand['kind'];

// ---------------------------------------------------------------------------
// Operators — arity encoded by the condition variant that uses them
// ---------------------------------------------------------------------------

export type BinaryOperator = 'crossover' | 'crossunder' | 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

export type UnaryOperator = 'rising' | 'falling';

export type RangeOperator = 'insideRange' | 'outsideRange';

export type Operator = BinaryOperator | UnaryOperator | RangeOperator;
export type OperatorArity = 'binary' | 'unary' | 'range';

export const BINARY_OPERATORS: readonly BinaryOperator[] = [
	'crossover',
	'crossunder',
	'gt',
	'gte',
	'lt',
	'lte',
	'eq'
] as const;
export const UNARY_OPERATORS: readonly UnaryOperator[] = ['rising', 'falling'] as const;
export const RANGE_OPERATORS: readonly RangeOperator[] = ['insideRange', 'outsideRange'] as const;

// ---------------------------------------------------------------------------
// Conditions & groups — fully nestable, unlimited depth/breadth
// ---------------------------------------------------------------------------

export type ConditionLeaf =
	| { kind: 'binary'; id: string; left: Operand; op: BinaryOperator; right: Operand }
	| { kind: 'unary'; id: string; operand: Operand; op: UnaryOperator; lookback: number }
	| {
			kind: 'range';
			id: string;
			operand: Operand;
			op: RangeOperator;
			lower: Operand;
			upper: Operand;
	  };

export type LeafKind = ConditionLeaf['kind'];

export interface ConditionGroup {
	kind: 'group';
	id: string;
	logic: 'AND' | 'OR';
	children: RuleNode[];
}

export type RuleNode = ConditionGroup | ConditionLeaf;

export interface Rules {
	longEntry: ConditionGroup;
	longExit: ConditionGroup;
	shortEntry: ConditionGroup;
	shortExit: ConditionGroup;
}

export type RuleSection = keyof Rules;

export const RULE_SECTIONS: readonly RuleSection[] = [
	'longEntry',
	'longExit',
	'shortEntry',
	'shortExit'
] as const;

// ---------------------------------------------------------------------------
// Risk — every mode a discriminated union
// ---------------------------------------------------------------------------

export type PositionSizing =
	| { mode: 'fixedShares'; shares: number }
	| { mode: 'fixedNotional'; notional: number }
	| { mode: 'percentEquity'; percent: number }
	| { mode: 'riskBased'; riskPercent: number }; // requires a non-'none' stopLoss

export type SizingMode = PositionSizing['mode'];

export type StopLoss =
	| { mode: 'none' }
	| { mode: 'percent'; percent: number }
	| { mode: 'atr'; atrRef: string; multiple: number }
	| { mode: 'points'; points: number };

export type TakeProfit =
	| { mode: 'none' }
	| { mode: 'percent'; percent: number }
	| { mode: 'rMultiple'; r: number }
	| { mode: 'atr'; atrRef: string; multiple: number };

export type TrailingStop =
	| { mode: 'none' }
	| { mode: 'percent'; percent: number }
	| { mode: 'atr'; atrRef: string; multiple: number };

export type CommissionModel =
	| { mode: 'none' }
	| { mode: 'perShare'; perShare: number }
	| { mode: 'perTrade'; perTrade: number }
	| { mode: 'percent'; percent: number };

export type SlippageModel =
	| { mode: 'none' }
	| { mode: 'percent'; percent: number }
	| { mode: 'ticks'; ticks: number; tickSize: number };

export interface Risk {
	initialCapital: number;
	positionSizing: PositionSizing;
	stopLoss: StopLoss;
	takeProfit: TakeProfit;
	trailingStop: TrailingStop;
	maxConcurrentPositions: number;
	pyramiding: number; // max additional entries per open position (0 = none)
	commission: CommissionModel;
	slippage: SlippageModel;
}

// ---------------------------------------------------------------------------
// Execution — explicit, look-ahead-safe defaults
// ---------------------------------------------------------------------------

/**
 * When a signalled order is filled.
 * - `nextOpen` (default): fill at the open of the bar AFTER the signal — no
 *   look-ahead bias. Signals are point-in-time.
 * - `close`: fill at the close of the signalling bar (assumes you can act on
 *   the close).
 * - `signalPrice`: fill at the operand/price that produced the signal.
 */
export type FillModel = 'nextOpen' | 'close' | 'signalPrice';
export type OrderType = 'market' | 'limit' | 'stop';

export const FILL_MODELS: readonly FillModel[] = ['nextOpen', 'close', 'signalPrice'] as const;
export const ORDER_TYPES: readonly OrderType[] = ['market', 'limit', 'stop'] as const;

export interface Execution {
	fillOn: FillModel;
	orderType: OrderType;
}

// ---------------------------------------------------------------------------
// Top-level spec
// ---------------------------------------------------------------------------

/** Bumped when the spec shape changes in a way that needs migration. */
export const SPEC_SCHEMA_VERSION = 1;

export interface StrategySpec {
	schemaVersion: number;
	name: string;
	universe: Universe;
	indicators: IndicatorInstance[];
	rules: Rules;
	risk: Risk;
	execution: Execution;
}

/** A persisted, versioned strategy (storage wrapper around a spec). */
export interface SavedStrategy {
	id: string;
	name: string;
	spec: StrategySpec;
	version: number;
	createdAt: string;
	updatedAt: string;
}
