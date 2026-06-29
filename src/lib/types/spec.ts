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

/**
 * Where the run's tradeable ticker set comes from.
 *
 * - `tickers` (default, omitted == this): use `Universe.tickers` verbatim — the
 *   explicit, fully backward-compatible behaviour.
 * - `index`: resolve point-in-time INDEX members at the run window via a
 *   survivorship-free provider (e.g. FMP PIT). `Universe.tickers` is still kept
 *   on the spec and used as a fallback/seed if resolution yields nothing.
 */
export type UniverseSource =
	| { kind: 'tickers' }
	| { kind: 'index'; provider: 'fmpPit'; index: string; maxSymbols?: number };

export interface Universe {
	tickers: string[];
	timeframe: TimeframeId;
	dateRange: DateRange;
	session: SessionSpec;
	/**
	 * How the tradeable ticker set is resolved for the run. Omitted (or
	 * `{ kind: 'tickers' }`) means use `tickers` verbatim — the default,
	 * backward-compatible behaviour. `{ kind: 'index', ... }` resolves
	 * point-in-time index members over the run window instead.
	 */
	source?: UniverseSource;
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

/**
 * Trigger for a scale-out level (§4c). A level fires when price reaches a profit
 * target expressed as either:
 * - `rMultiple`: `r` units of initial risk in profit (entry ± r × |entry − stop|).
 *   Requires a non-'none' stopLoss to define R; rejected by validation otherwise.
 * - `percent`: `percent`% of the entry price in profit (entry ± entry × percent/100).
 */
export type ScaleOutTrigger =
	| { kind: 'rMultiple'; r: number }
	| { kind: 'percent'; percent: number };

/**
 * One scale-out level (§4c): when price reaches `trigger`, close `fraction` of
 * the ORIGINAL position quantity (taken once, at the level price) and let the
 * rest run. `fraction` is in (0, 1).
 */
export interface ScaleOutLevel {
	trigger: ScaleOutTrigger;
	/** Fraction of the ORIGINAL position qty closed at this level, in (0, 1). */
	fraction: number;
}

/**
 * Scale-out / partial-profit configuration (§4c). One or more ascending profit
 * targets, each closing a fraction of the original position; whatever is left
 * after all levels fire is the "runner", managed by the normal stop / target /
 * trailing / signal logic. Omitted = no scale-out (today's behaviour).
 *
 * Partial closes are checked INTRABAR using only the current bar's OHLC (exactly
 * like stops/targets — never the future), keeping the engine leak-free. The sum
 * of all `fraction`s must be ≤ 1; a sum of exactly 1 leaves no runner (the last
 * level fully closes the position).
 */
export interface ScaleOut {
	levels: ScaleOutLevel[];
}

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
	/**
	 * Scale-out / partial-profit lifecycle (§4c). Ascending profit targets, each
	 * closing a fraction of the ORIGINAL position quantity, leaving a runner the
	 * normal stop/target/trailing/signal logic manages. `undefined` = no scale-out
	 * (today's behaviour). Checked intrabar with current-bar OHLC only (leak-free).
	 */
	scaleOut?: ScaleOut;
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
	/**
	 * §5 Correlation-exposure limit. Before opening a NEW position on ticker X, the
	 * Pearson correlation of close-to-close returns between X and each currently-open
	 * position on a DIFFERENT ticker Y is computed over the trailing
	 * `correlationLookback` bars, aligned on the common timestamps that are ≤ the
	 * entry decision time (point-in-time — never future bars). If `|corr|` with ANY
	 * open position exceeds this threshold, the new entry is SKIPPED. Same-ticker
	 * pyramiding is exempt. Pairs with fewer than a small floor of paired
	 * observations are skipped (treated as allowed). `undefined` = off. In (0, 1].
	 */
	maxCorrelation?: number;
	/**
	 * §5 Lookback window (in bars) for the correlation-exposure limit's
	 * close-to-close returns. Only consulted when `maxCorrelation` is set. Positive
	 * integer; `undefined` defaults to 60 in the engine. Should be ≥ ~20 so the
	 * correlation estimate is meaningful.
	 */
	correlationLookback?: number;
	/**
	 * §5 Margin / leverage. Maximum gross exposure as a multiple of equity: buying
	 * power = equity × maxLeverage, and the resulting GROSS exposure
	 * (Σ |qty × price| across all open positions including the candidate) may not
	 * exceed it — entries (and pyramided adds) that would breach it are SKIPPED.
	 * `undefined`/`1` = cash-only (cannot exceed equity), exactly today's behaviour.
	 * The portfolio heat cap is independent and still enforced. ≥ 1.
	 */
	maxLeverage?: number;
	/**
	 * §5 Margin interest: annual rate, in percent, charged on the cash BORROWED to
	 * finance LONG positions on margin (when `maxLeverage > 1`). At entry the
	 * borrowed cash attributed to a long position is
	 * `min(entryNotional, max(0, grossExposureAfterEntry − equityAtEntry))`; at close
	 * it accrues `borrowedAttributed × (APR/100) × (timeframeSeconds/31_557_600) ×
	 * barsHeld`, deducted from cash and the trade's P&L (mirrors the short-borrow
	 * accrual). Shorts are unaffected here. `undefined`/`0` = no interest; with
	 * `maxLeverage = 1` the borrowed amount is 0 so there is no change. In [0, ∞).
	 */
	marginInterestAPR?: number;
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
