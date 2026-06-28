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
	/** Optional buy-and-hold comparison ticker (e.g. 'SPY') overlaid on results. */
	benchmark?: string;
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
	/**
	 * Multi-timeframe reference (spec §3 / §4a). When set to a HIGHER timeframe than
	 * the universe's, the indicator is computed on resampled higher-timeframe bars
	 * and aligned back to base bars with NO look-ahead: a higher-TF bar's value is
	 * available at a base bar only AFTER that higher-TF bar has CLOSED. Omitted (or
	 * equal to the universe timeframe) = current behaviour (computed on base bars).
	 * A timeframe LOWER than the universe's is rejected by validation (it would
	 * fabricate sub-bar data).
	 */
	timeframe?: TimeframeId;
}

// ---------------------------------------------------------------------------
// Operands (discriminated union). `offset` = N bars ago (0 = current bar).
// ---------------------------------------------------------------------------

/**
 * Reductions an `aggregate` operand can apply over its trailing window.
 * - `highest` / `lowest`: extreme of the window
 * - `mean`: arithmetic average
 * - `sum`: total
 */
export type AggregateFn = 'highest' | 'lowest' | 'mean' | 'sum';

export const AGGREGATE_FNS: readonly AggregateFn[] = ['highest', 'lowest', 'mean', 'sum'] as const;

export type Operand =
	| { kind: 'indicator'; ref: string; component?: string; offset: number }
	| { kind: 'price'; field: PriceField; offset: number }
	| { kind: 'constant'; value: number }
	/**
	 * Reduction of `source` over the trailing window of `window` bars ending
	 * `offset` bars ago: it reads bars `[i-offset-window+1 .. i-offset]`. If any
	 * index is < 0 or `source` resolves to `NaN` at any of them, the aggregate is
	 * `NaN` (→ its leaf is false). `window` ≥ 1, `offset` ≥ 0. Enables e.g.
	 * "close > highest high of the last 20 bars".
	 */
	| { kind: 'aggregate'; fn: AggregateFn; source: Operand; window: number; offset: number };

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

/** Comparison operators usable by a `persistence` leaf (ordered, non-cross). */
export type PersistenceOperator = 'gt' | 'gte' | 'lt' | 'lte';

export const PERSISTENCE_OPERATORS: readonly PersistenceOperator[] = [
	'gt',
	'gte',
	'lt',
	'lte'
] as const;

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
	  }
	/**
	 * True iff `(operand op threshold)` holds at EACH of the last `bars` closed
	 * bars (`i`, `i-1`, …, `i-bars+1`). Any NaN operand/threshold or an
	 * out-of-range index (e.g. `i-bars+1 < 0`) makes the whole leaf false.
	 * `bars` ≥ 1. Enables e.g. "RSI > 70 for 3 consecutive bars".
	 */
	| {
			kind: 'persistence';
			id: string;
			operand: Operand;
			op: PersistenceOperator;
			threshold: Operand;
			bars: number;
	  }
	/**
	 * True iff `second` is true at bar `i` AND `first` was true at some bar `t` in
	 * `[i-withinBars, i-1]` (scanning strictly backwards — point-in-time only,
	 * never the future). `withinBars` ≥ 1. Enables ordered multi-bar setups.
	 */
	| {
			kind: 'sequence';
			id: string;
			first: ConditionLeaf;
			second: ConditionLeaf;
			withinBars: number;
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
	| { mode: 'riskBased'; riskPercent: number } // requires a non-'none' stopLoss
	| { mode: 'volatilityTarget'; targetVolPercent: number; atrRef: string }
	/**
	 * Fractional-Kelly sizing (§5). Sizes from the rolling stats of CLOSED trades
	 * SO FAR in the run (point-in-time — never future trades): win rate
	 * `W = wins/total`, payoff `R = avgWin/|avgLoss|`, Kelly `f* = max(0, W − (1−W)/R)`.
	 * `shares = floor(equity × fraction × f* / fillPrice)`, ≥ 0. `fraction` in (0, 1]
	 * (typically ≤ 0.5) scales the full-Kelly bet down for safety. During warmup
	 * (fewer than 5 closed trades) or when `R`/avgLoss is undefined/0, `f*` is
	 * treated as 0 → size 0 (conservative: trade only once an edge has been
	 * observed). Leak-free: the aggregates read at entry include only already-closed
	 * trades.
	 */
	| { mode: 'fractionalKelly'; fraction: number };

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
	/**
	 * Short borrow cost (§ costs): annual borrow rate, in percent, charged on the
	 * notional of any OPEN SHORT position for every bar it is held. `undefined`/`0`
	 * = no borrow cost. Per-bar cost = shortNotional × (APR/100) ×
	 * (timeframeSeconds / 31_557_600); it is summed over the bars held and deducted
	 * from cash and the trade's P&L at close. Longs are unaffected. In [0, ∞).
	 */
	shortBorrowAPR?: number;
	/**
	 * Time exit: force-close an open position once it has been held this many bars,
	 * filled look-ahead-safe at the next bar's open (same path as a signal exit).
	 * `undefined`/`0` = no time limit. Positive integer.
	 */
	maxBarsInTrade?: number;
	/**
	 * Portfolio drawdown circuit-breaker. Once marked equity falls below the
	 * running peak by at least this percent, ALL new entries are halted for the
	 * rest of the run (open positions keep being managed/exited normally).
	 * `undefined` = off. In (0, 100].
	 */
	maxDrawdownStopPercent?: number;
	/**
	 * Max portfolio heat: total open risk (sum of qty × |entry − stop| across open
	 * positions, including the candidate) may not exceed this percent of current
	 * equity. Entries with no stop are not constrained. `undefined` = off. In (0, 100].
	 */
	maxPortfolioHeatPercent?: number;
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
	/**
	 * Liquidity cap (§2.3): max share of a bar's volume a single fill may take,
	 * as a percentage in (0, 100]. Caps filled qty at `floor(bar.volume * pct/100)`.
	 * `undefined` means no cap (fills are not constrained by bar volume).
	 */
	maxBarVolumePct?: number;
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
