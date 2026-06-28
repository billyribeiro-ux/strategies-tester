import { describe, it, expect } from 'vitest';
import type {
	BinaryOperator,
	Candle,
	ConditionGroup,
	ConditionLeaf,
	Operand,
	PriceField,
	StrategySpec
} from '$lib/types';
import { runBacktest } from './engine';
import { assertNoLookahead, perturbAfter } from './leak-gate';
import { trueRange, wilderSmooth, ema } from './series';
import { resampleBySeconds, alignToBase } from './mtf';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function candles(closes: number[]): Candle[] {
	// o = previous close (or first close), h/l bracket the bar by ±0.5,
	// so intrabar stops/targets have room but don't trigger spuriously here.
	return closes.map((c, i) => {
		const o = i === 0 ? c : closes[i - 1];
		const hi = Math.max(o, c) + 0.5;
		const lo = Math.min(o, c) - 0.5;
		return {
			t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
			o,
			h: hi,
			l: lo,
			c,
			v: 1000
		};
	});
}

/** Build candles from explicit [o, h, l, c] tuples (volume 1000), for precise
 *  control of intrabar range in limit/stop entry tests. */
function ohlc(bars: [number, number, number, number][]): Candle[] {
	return bars.map(([o, h, l, c], i) => ({
		t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
		o,
		h,
		l,
		c,
		v: 1000
	}));
}

function group(logic: 'AND' | 'OR', children: (ConditionLeaf | ConditionGroup)[]): ConditionGroup {
	return { kind: 'group', id: `g_${Math.random().toString(36).slice(2)}`, logic, children };
}

function emptyGroup(): ConditionGroup {
	return group('AND', []);
}

function binary(left: Operand, op: BinaryOperator, right: Operand): ConditionLeaf {
	return { kind: 'binary', id: `l_${Math.random().toString(36).slice(2)}`, left, op, right };
}

const price = (field: PriceField, offset = 0): Operand => ({
	kind: 'price',
	field,
	offset
});
const constant = (value: number): Operand => ({ kind: 'constant', value });
const indicator = (ref: string, component = 'value', offset = 0): Operand => ({
	kind: 'indicator',
	ref,
	component,
	offset
});

function baseSpec(overrides: Partial<StrategySpec> = {}): StrategySpec {
	return {
		schemaVersion: 1,
		name: 'Test',
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

/** Drop fields that legitimately vary between runs (runId, timestamps). */
function normalize(result: ReturnType<typeof runBacktest>) {
	const trades = result.trades.map((t) => ({ ...t, id: 'x' }));
	const audit = { ...result.audit, computedAt: 'x' };
	return { ...result, runId: 'x', computedAt: 'x', trades, audit };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runBacktest — determinism', () => {
	it('produces identical output for identical inputs', () => {
		const spec = baseSpec({
			rules: {
				longEntry: group('AND', [binary(price('close'), 'gt', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'lt', constant(103))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const data = { TEST: candles([100, 102, 104, 106, 108, 104, 102, 100, 106, 110]) };
		const a = normalize(runBacktest(spec, data));
		const b = normalize(runBacktest(spec, data));
		expect(a).toEqual(b);
	});
});

describe('runBacktest — no look-ahead', () => {
	it('earlier trades are unchanged when later candles are truncated', () => {
		const spec = baseSpec({
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		// Crosses above 105 at index 3 (104→106), fills next open (index 4).
		// Crosses below 105 at index 6 (106→104), fills next open (index 7).
		const full = candles([100, 102, 104, 106, 108, 110, 104, 102, 100, 108, 112, 116]);
		const truncated = full.slice(0, 9); // keep through the first exit fill (idx 7) + 1

		const a = runBacktest(spec, { TEST: full });
		const b = runBacktest(spec, { TEST: truncated });

		expect(a.trades.length).toBeGreaterThanOrEqual(1);
		const firstA = a.trades[0];
		const firstB = b.trades[0];
		expect(firstB).toBeDefined();
		expect(firstA.entryTime).toBe(firstB.entryTime);
		expect(firstA.entryPrice).toBe(firstB.entryPrice);
		expect(firstA.exitTime).toBe(firstB.exitTime);
		expect(firstA.exitPrice).toBe(firstB.exitPrice);
		expect(firstA.pnl).toBeCloseTo(firstB.pnl, 9);
	});
});

describe('runBacktest — known crossover trade', () => {
	it('opens long on crossover, exits on signal, with positive pnl', () => {
		const spec = baseSpec({
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		// close: idx0..7
		// 100,102,104,106(cross↑),108,104(cross↓),102,100
		const data = { TEST: candles([100, 102, 104, 106, 108, 104, 102, 100]) };
		const result = runBacktest(spec, data);

		expect(result.trades.length).toBe(1);
		const trade = result.trades[0];
		expect(trade.side).toBe('long');
		expect(trade.exitReason).toBe('signalExit');
		// Entry fills at open of bar after the crossover (idx 4, open=106).
		expect(trade.entryPrice).toBe(106);
		// Crossunder at idx 5 (106→104), exit fills at open of idx 6 (open=104).
		expect(trade.exitPrice).toBe(104);
		// Long 100 sh from 106 to 104 → loss. Verify sign matches price move.
		expect(trade.pnl).toBeCloseTo((104 - 106) * 100, 9);
		expect(trade.pnl).toBeLessThan(0);
	});

	it('a profitable long crossover yields positive pnl and correct cumulative', () => {
		const spec = baseSpec({
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', constant(115))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		// rises through 105 then falls back through 115 after a run-up.
		const data = { TEST: candles([100, 104, 106, 110, 116, 120, 118, 114, 110]) };
		const result = runBacktest(spec, data);
		expect(result.trades.length).toBe(1);
		const t = result.trades[0];
		expect(t.side).toBe('long');
		expect(t.pnl).toBeGreaterThan(0);
		expect(t.cumulativePnl).toBeCloseTo(t.pnl, 9);
	});
});

describe('runBacktest — stop loss', () => {
	it('exits at the stop price with exitReason stopHit', () => {
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				stopLoss: { mode: 'percent', percent: 2 }
			},
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		// Enter long around 106, then a big down bar to trigger the 2% stop.
		const raw: Candle[] = candles([100, 102, 104, 106, 108]);
		// Force a deep low on the bar after entry so the stop is hit intrabar.
		raw[4] = { ...raw[4], l: 90 };
		const result = runBacktest(spec, { TEST: raw });
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].exitReason).toBe('stopHit');
		expect(result.trades[0].stopPrice).not.toBeNull();
		// Stop = entry * 0.98; entry filled at open of idx 4 = 106.
		expect(result.trades[0].exitPrice).toBeCloseTo(106 * 0.98, 9);
	});
});

describe('runBacktest — metric sanity', () => {
	it('produces no NaN metrics for a normal run', () => {
		const spec = baseSpec({
			indicators: [
				{ id: 'sma_fast', type: 'sma', params: { period: 3 }, priceSource: 'close' },
				{ id: 'sma_slow', type: 'sma', params: { period: 5 }, priceSource: 'close' }
			],
			rules: {
				longEntry: group('AND', [
					binary(indicator('sma_fast'), 'crossover', indicator('sma_slow'))
				]),
				longExit: group('AND', [
					binary(indicator('sma_fast'), 'crossunder', indicator('sma_slow'))
				]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 8 + i * 0.1);
		const result = runBacktest(spec, { TEST: candles(closes) });

		for (const m of result.metrics) {
			expect(Number.isNaN(m.value)).toBe(false);
			expect(Number.isFinite(m.value) || m.value === 1e9).toBe(true);
		}
		// Equity curve has one point per timeline bar.
		expect(result.equityCurve.length).toBe(closes.length);
		expect(result.drawdown.length).toBe(closes.length);
	});

	it('handles a zero-trade strategy without NaN', () => {
		const spec = baseSpec({
			rules: {
				longEntry: group('AND', [binary(price('close'), 'gt', constant(1e9))]), // never
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const result = runBacktest(spec, { TEST: candles([100, 101, 102, 103, 104]) });
		expect(result.trades.length).toBe(0);
		for (const m of result.metrics) expect(Number.isNaN(m.value)).toBe(false);
		const totalReturn = result.metrics.find((m) => m.id === 'totalReturn')!;
		expect(totalReturn.value).toBe(0);
	});
});

describe('runBacktest — warnings & no data', () => {
	it('warns and skips tickers with no candles', () => {
		const spec = baseSpec({ universe: { ...baseSpec().universe, tickers: ['TEST', 'EMPTY'] } });
		const result = runBacktest(spec, { TEST: candles([100, 101, 102]), EMPTY: [] });
		expect(result.warnings.some((w) => w.includes('EMPTY'))).toBe(true);
	});
});

describe('runBacktest — lookahead-optimistic fill models (G1 / §2.2)', () => {
	it('warns when filling at the signal bar (close / signalPrice)', () => {
		const rules = {
			longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
			longExit: emptyGroup(),
			shortEntry: emptyGroup(),
			shortExit: emptyGroup()
		};
		const data = { TEST: candles([100, 104, 106, 108, 110]) };

		const closeFill = runBacktest(
			baseSpec({ rules, execution: { fillOn: 'close', orderType: 'market' } }),
			data
		);
		expect(closeFill.warnings.some((w) => /lookahead-optimistic/i.test(w))).toBe(true);

		// The realistic default must NOT warn.
		const nextOpen = runBacktest(
			baseSpec({ rules, execution: { fillOn: 'nextOpen', orderType: 'market' } }),
			data
		);
		expect(nextOpen.warnings.some((w) => /lookahead-optimistic/i.test(w))).toBe(false);
	});
});

describe('runBacktest — short side', () => {
	it('profits when price falls after a short entry', () => {
		const spec = baseSpec({
			rules: {
				longEntry: emptyGroup(),
				longExit: emptyGroup(),
				shortEntry: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortExit: group('AND', [binary(price('close'), 'crossover', constant(95))])
			}
		});
		// Falls through 105, keeps falling, then rises back through 95.
		const data = { TEST: candles([110, 108, 104, 100, 96, 92, 94, 96, 98]) };
		const result = runBacktest(spec, data);
		expect(result.trades.length).toBe(1);
		const t = result.trades[0];
		expect(t.side).toBe('short');
		expect(t.pnl).toBeGreaterThan(0);
	});
});

describe('runBacktest — audit record (§8/§10)', () => {
	it('captures execution assumptions; lookaheadOptimistic=true for close fills', () => {
		const spec = baseSpec({
			universe: { ...baseSpec().universe, tickers: ['TEST'], timeframe: '1h' },
			risk: {
				...baseSpec().risk,
				initialCapital: 50_000,
				commission: { mode: 'perShare', perShare: 0.01 },
				slippage: { mode: 'percent', percent: 0.1 }
			},
			execution: { fillOn: 'close', orderType: 'market' }
		});
		const data = { TEST: candles([100, 102, 104, 106, 108]) };
		const result = runBacktest(spec, data);

		expect(result.audit.fillModel).toBe('close');
		expect(result.audit.orderType).toBe('market');
		expect(result.audit.commissionMode).toBe('perShare');
		expect(result.audit.slippageMode).toBe('percent');
		expect(result.audit.initialCapital).toBe(50_000);
		expect(result.audit.timeframe).toBe('1h');
		expect(result.audit.tickers).toEqual(['TEST']);
		expect(result.audit.bars).toBe(5);
		expect(result.audit.liquidityCapPct).toBeNull();
		expect(result.audit.lookaheadOptimistic).toBe(true);
		expect(result.audit.schemaVersion).toBe(spec.schemaVersion);
		// computedAt is reused from the result so the two stay in lockstep.
		expect(result.audit.computedAt).toBe(result.computedAt);
	});

	it('lookaheadOptimistic=false for the realistic nextOpen fill model', () => {
		const result = runBacktest(
			baseSpec({ execution: { fillOn: 'nextOpen', orderType: 'market' } }),
			{ TEST: candles([100, 101, 102]) }
		);
		expect(result.audit.fillModel).toBe('nextOpen');
		expect(result.audit.lookaheadOptimistic).toBe(false);
	});
});

describe('runBacktest — liquidity cap (§2.3)', () => {
	it('caps fill qty at floor(volume * pct/100) and warns once', () => {
		// Volume is 1000/bar (see candles()). 5% cap → max 50 shares per fill.
		// fixedShares wants 100, so the cap must bite.
		const spec = baseSpec({
			risk: { ...baseSpec().risk, positionSizing: { mode: 'fixedShares', shares: 100 } },
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			},
			execution: { fillOn: 'nextOpen', orderType: 'market', maxBarVolumePct: 5 }
		});
		const data = { TEST: candles([100, 102, 104, 106, 108, 104, 102, 100]) };
		const result = runBacktest(spec, data);

		expect(result.trades.length).toBe(1);
		const cap = Math.floor((1000 * 5) / 100); // 50
		expect(result.trades[0].qty).toBeLessThanOrEqual(cap);
		expect(result.trades[0].qty).toBe(cap);
		expect(result.audit.liquidityCapPct).toBe(5);
		expect(
			result.warnings.some((w) => /Liquidity cap limited fill size on 1 orders\./.test(w))
		).toBe(true);
	});

	it('leaves qty unchanged and emits no warning when uncapped', () => {
		const spec = baseSpec({
			risk: { ...baseSpec().risk, positionSizing: { mode: 'fixedShares', shares: 100 } },
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const data = { TEST: candles([100, 102, 104, 106, 108, 104, 102, 100]) };
		const result = runBacktest(spec, data);

		expect(result.trades.length).toBe(1);
		expect(result.trades[0].qty).toBe(100);
		expect(result.audit.liquidityCapPct).toBeNull();
		expect(result.warnings.some((w) => /Liquidity cap/.test(w))).toBe(false);
	});

	it('skips the entry when the cap reduces qty to zero', () => {
		// 0.05% of volume 1000 = floor(0.5) = 0 shares → no trade.
		const spec = baseSpec({
			risk: { ...baseSpec().risk, positionSizing: { mode: 'fixedShares', shares: 100 } },
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			},
			execution: { fillOn: 'nextOpen', orderType: 'market', maxBarVolumePct: 0.05 }
		});
		const data = { TEST: candles([100, 102, 104, 106, 108]) };
		const result = runBacktest(spec, data);

		expect(result.trades.length).toBe(0);
		expect(result.warnings.some((w) => /Liquidity cap limited fill size/.test(w))).toBe(true);
	});
});

describe('runBacktest — volatilityTarget sizing (§5)', () => {
	it('sizes shares from floor((equity * targetVol/100) / atrValue)', () => {
		// ATR period 3 over a monotonically rising series settles at a known value.
		// We assert the engine sized exactly floor(volBudget / atrAtEntry).
		const spec = baseSpec({
			indicators: [{ id: 'atr1', type: 'atr', params: { period: 3 }, priceSource: 'close' }],
			risk: {
				...baseSpec().risk,
				initialCapital: 100_000,
				positionSizing: { mode: 'volatilityTarget', targetVolPercent: 1, atrRef: 'atr1' }
			},
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const data = { TEST: candles([100, 102, 104, 106, 108, 104, 102, 100]) };
		const result = runBacktest(spec, data);

		expect(result.trades.length).toBe(1);
		const t = result.trades[0];
		// Entry fills at open of idx 4 (crossover at idx 3). Derive the engine's ATR
		// at idx 4 using the SAME series helpers the indicator uses, so the expected
		// qty cannot drift from the engine's own ATR computation.
		const bars = candles([100, 102, 104, 106, 108, 104, 102, 100]);
		const atrSeries = wilderSmooth(trueRange(bars), 3);
		const atrAtEntry = atrSeries[4];
		const expectedQty = Math.floor((100_000 * (1 / 100)) / atrAtEntry);
		expect(Number.isFinite(atrAtEntry)).toBe(true);
		expect(t.qty).toBe(expectedQty);
		expect(t.qty).toBeGreaterThan(0);
	});

	it('sizes 0 (no trade) when the ATR ref is non-finite/unavailable', () => {
		// No ATR indicator declared → atrValue is NaN → size 0 → no trade.
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				positionSizing: { mode: 'volatilityTarget', targetVolPercent: 1, atrRef: 'missing' }
			},
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const data = { TEST: candles([100, 102, 104, 106, 108]) };
		const result = runBacktest(spec, data);
		expect(result.trades.length).toBe(0);
	});
});

describe('runBacktest — time exit / maxBarsInTrade (§5)', () => {
	it('forces an exit after N bars, filling at the next bar open', () => {
		// Enter long (crossover at idx 3 → fill open idx 4). No signal exit, so the
		// time exit must close it. maxBarsInTrade=2: bars-held reaches 2 at idx 6,
		// which fills at the open of idx 7.
		const spec = baseSpec({
			risk: { ...baseSpec().risk, maxBarsInTrade: 2 },
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		// closes idx0..7; open of idx7 = close of idx6 = 112 (see candles()).
		const data = { TEST: candles([100, 102, 104, 106, 108, 110, 112, 114]) };
		const result = runBacktest(spec, data);

		expect(result.trades.length).toBe(1);
		const t = result.trades[0];
		expect(t.entryPrice).toBe(106); // open of idx 4
		expect(t.barsHeld).toBe(3); // exit idx 7 - entry idx 4
		expect(t.exitTime).toBe(data.TEST[7].t);
		expect(t.exitPrice).toBe(data.TEST[7].o); // next-open fill
		expect(t.exitReason).toBe('signalExit'); // reused reason (result.ts not edited)
	});

	it('does not force an exit when maxBarsInTrade is undefined', () => {
		const spec = baseSpec({
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const data = { TEST: candles([100, 102, 104, 106, 108, 110, 112, 114]) };
		const result = runBacktest(spec, data);
		// Only closes at end of data, never a mid-run time exit.
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].exitReason).toBe('endOfData');
	});
});

describe('runBacktest — drawdown circuit-breaker (§5)', () => {
	it('halts new entries after equity falls past the drawdown limit', () => {
		// A losing long opens, drops hard (tripping the breaker), then a later
		// crossover that WOULD re-enter is suppressed → only one trade.
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				initialCapital: 10_000,
				positionSizing: { mode: 'percentEquity', percent: 100 },
				maxDrawdownStopPercent: 5
			},
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		// First crossover ~idx3 (fill idx4 @106), big drop, crossunder exits at a loss
		// big enough to exceed 5% DD. Then price crosses 105 again later.
		const data = { TEST: candles([100, 102, 104, 106, 90, 80, 102, 104, 106, 108, 104]) };
		const result = runBacktest(spec, data);

		expect(result.trades.length).toBe(1);
		expect(result.warnings.some((w) => /circuit-breaker tripped/i.test(w))).toBe(true);
	});

	it('does not halt entries when the limit is not reached', () => {
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				maxDrawdownStopPercent: 90 // effectively unreachable here
			},
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const data = { TEST: candles([100, 102, 104, 106, 104, 102, 106, 108, 104]) };
		const result = runBacktest(spec, data);
		expect(result.trades.length).toBeGreaterThanOrEqual(2);
		expect(result.warnings.some((w) => /circuit-breaker/i.test(w))).toBe(false);
	});
});

describe('runBacktest — limit & stop entry orders (§5)', () => {
	// A long crossover over 105 fires at idx 2 (close 104 → 106): the order's
	// reference price is the SIGNAL bar's close (106). The order is good for the
	// NEXT bar only (idx 3) and expires if that bar doesn't reach it.
	const longCrossRules = {
		longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
		longExit: emptyGroup(),
		shortEntry: emptyGroup(),
		shortExit: emptyGroup()
	};
	// closes: 100, 104, 106(cross), <fill bar idx3>, ...
	// idx0/idx1 produce the crossover; idx3 [o,h,l,c] decides the fill; idx4 is
	// quiet so no further entries (and the position closes at endOfData).
	function longSeries(fillBar: [number, number, number, number]): Candle[] {
		return ohlc([
			[100, 100.5, 99.5, 100],
			[100, 104.5, 99.5, 104],
			[104, 106.5, 103.5, 106],
			fillBar,
			[fillBar[3], fillBar[3] + 0.5, fillBar[3] - 0.5, fillBar[3]]
		]);
	}

	it('limit (long): fills at the limit on a dip', () => {
		// ref = 106. Next bar dips to low 104 (≤ 106) but opens at 108 (> limit):
		// fills at the limit, price = min(open 108, limit 106) = 106.
		const spec = baseSpec({
			rules: longCrossRules,
			execution: { fillOn: 'nextOpen', orderType: 'limit' }
		});
		const data = { TEST: longSeries([108, 109, 104, 107]) };
		const result = runBacktest(spec, data);
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].side).toBe('long');
		expect(result.trades[0].entryPrice).toBe(106);
		expect(result.trades[0].entryTime).toBe(data.TEST[3].t);
	});

	it('limit (long): fills at the better open when the bar gaps below the limit', () => {
		// ref = 106. Next bar gaps down: open 105 (< limit), low 103.
		// fills at min(open 105, limit 106) = 105 (the better price).
		const spec = baseSpec({
			rules: longCrossRules,
			execution: { fillOn: 'nextOpen', orderType: 'limit' }
		});
		const result = runBacktest(spec, { TEST: longSeries([105, 106, 103, 104]) });
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].entryPrice).toBe(105);
	});

	it('limit (long): expires (no trade) when the next bar never dips to the limit', () => {
		// ref = 106. Next bar low 108 (> limit) → order expires unfilled.
		const spec = baseSpec({
			rules: longCrossRules,
			execution: { fillOn: 'nextOpen', orderType: 'limit' }
		});
		const result = runBacktest(spec, { TEST: longSeries([110, 112, 108, 111]) });
		expect(result.trades.length).toBe(0);
	});

	it('stop (long): fills on a breakout at the stop level', () => {
		// ref = 106. Next bar opens 105 (< stop) and breaks up to high 108 (≥ stop):
		// fills at max(open 105, stop 106) = 106.
		const spec = baseSpec({
			rules: longCrossRules,
			execution: { fillOn: 'nextOpen', orderType: 'stop' }
		});
		const data = { TEST: longSeries([105, 108, 104, 107]) };
		const result = runBacktest(spec, data);
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].entryPrice).toBe(106);
		expect(result.trades[0].entryTime).toBe(data.TEST[3].t);
	});

	it('stop (long): a gap-through fills at the (worse) open', () => {
		// ref = 106. Next bar gaps up through the stop: open 109 (> stop), high 110.
		// fills at max(open 109, stop 106) = 109 (the open).
		const spec = baseSpec({
			rules: longCrossRules,
			execution: { fillOn: 'nextOpen', orderType: 'stop' }
		});
		const result = runBacktest(spec, { TEST: longSeries([109, 110, 108, 109]) });
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].entryPrice).toBe(109);
	});

	it('stop (long): expires (no trade) when the next bar never reaches the stop', () => {
		// ref = 106. Next bar high 105.5 (< stop) → order expires unfilled.
		const spec = baseSpec({
			rules: longCrossRules,
			execution: { fillOn: 'nextOpen', orderType: 'stop' }
		});
		const result = runBacktest(spec, { TEST: longSeries([104, 105.5, 103, 104.5]) });
		expect(result.trades.length).toBe(0);
	});

	it('short limit: fills only when the next bar trades up to the limit', () => {
		// Short crossunder below 105 fires at idx 2 (close 106 → 104), ref = 104.
		// Next bar must reach high ≥ 104 to fill; price = max(open, limit).
		const rules = {
			longEntry: emptyGroup(),
			longExit: emptyGroup(),
			shortEntry: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
			shortExit: emptyGroup()
		};
		const spec = baseSpec({
			rules,
			execution: { fillOn: 'nextOpen', orderType: 'limit' }
		});
		// idx2 close 104 = signal; idx3 opens 102 (< limit) but rises to high 106 (≥ limit):
		// fills at max(open 102, limit 104) = 104.
		const fills = ohlc([
			[110, 110.5, 109.5, 110],
			[110, 110.5, 105.5, 106],
			[106, 106.5, 103.5, 104],
			[102, 106, 101, 105],
			[105, 105.5, 104.5, 105]
		]);
		const result = runBacktest(spec, { TEST: fills });
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].side).toBe('short');
		expect(result.trades[0].entryPrice).toBe(104);
	});

	it('limit & stop entries are leak-free (gate passes over a zigzag series)', () => {
		// Run the engine-agnostic leak gate against both new order types on a series
		// that crosses 105 repeatedly, so many limit/stop orders fill and settle.
		const closes = Array.from({ length: 60 }, (_, i) => 105 + Math.sin(i / 2) * 7);
		const data = { TEST: candles(closes) };
		const rules = {
			longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
			longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
			shortEntry: emptyGroup(),
			shortExit: emptyGroup()
		};
		expect(() =>
			assertNoLookahead(
				baseSpec({ rules, execution: { fillOn: 'nextOpen', orderType: 'limit' } }),
				data
			)
		).not.toThrow();
		expect(() =>
			assertNoLookahead(
				baseSpec({ rules, execution: { fillOn: 'nextOpen', orderType: 'stop' } }),
				data
			)
		).not.toThrow();
	});

	it('market (default) is unchanged: fills at the next bar open', () => {
		// Same signal series; a market order fills at the next bar's OPEN regardless
		// of where the bar trades.
		const spec = baseSpec({
			rules: longCrossRules,
			execution: { fillOn: 'nextOpen', orderType: 'market' }
		});
		const result = runBacktest(spec, { TEST: longSeries([108, 109, 104, 107]) });
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].entryPrice).toBe(108); // open of fill bar, not the limit
	});
});

describe('runBacktest — portfolio heat cap (§5)', () => {
	it('blocks an over-risked entry and warns', () => {
		// percentEquity 100% + a 50% stop ⇒ open risk ≈ 50% of equity per position.
		// heat cap of 10% is far below that, so the entry is blocked → no trade.
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				initialCapital: 10_000,
				positionSizing: { mode: 'percentEquity', percent: 100 },
				stopLoss: { mode: 'percent', percent: 50 },
				maxPortfolioHeatPercent: 10
			},
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const data = { TEST: candles([100, 102, 104, 106, 108]) };
		const result = runBacktest(spec, data);

		expect(result.trades.length).toBe(0);
		expect(result.warnings.some((w) => /heat cap blocked/i.test(w))).toBe(true);
	});

	it('allows an entry whose risk fits within the heat budget', () => {
		// Small stop (2%) → open risk ≈ 2% of equity, under a 25% heat cap → trades.
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				initialCapital: 100_000,
				positionSizing: { mode: 'percentEquity', percent: 100 },
				stopLoss: { mode: 'percent', percent: 2 },
				maxPortfolioHeatPercent: 25
			},
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: emptyGroup(),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const data = { TEST: candles([100, 102, 104, 106, 108]) };
		const result = runBacktest(spec, data);

		expect(result.trades.length).toBe(1);
		expect(result.warnings.some((w) => /heat cap/i.test(w))).toBe(false);
	});
});

describe('runBacktest — fractional-Kelly sizing (§5)', () => {
	// Each cycle: close starts at 100, crosses 102 to enter (fills next open ≈103),
	// then EITHER jumps up (5% take-profit hit → clean +5% win) or drops hard (5%
	// stop hit → clean −5% loss), then returns to 100 so the next cycle re-crosses.
	// Equal-magnitude wins/losses make the payoff ratio R ≈ 1, so a high win rate
	// gives a solidly positive Kelly fraction. One trade per cycle, deterministic.
	const winCycle = [100, 101, 103, 112, 100, 100]; // enter ≈103, gap to 112 → TP
	const loseCycle = [100, 101, 103, 90, 100, 100]; // enter ≈103, gap to 90 → stop
	function cyclesFrom(pattern: boolean[], reps: number): number[] {
		const out: number[] = [];
		for (let k = 0; k < reps; k++)
			for (const win of pattern) out.push(...(win ? winCycle : loseCycle));
		return out;
	}

	const kellyRisk = {
		...baseSpec().risk,
		initialCapital: 1_000_000,
		positionSizing: { mode: 'fractionalKelly' as const, fraction: 0.5 },
		stopLoss: { mode: 'percent' as const, percent: 5 },
		takeProfit: { mode: 'percent' as const, percent: 5 }
	};
	const kellyRules = {
		longEntry: group('AND', [binary(price('close'), 'crossover', constant(102))]),
		longExit: emptyGroup(),
		shortEntry: emptyGroup(),
		shortExit: emptyGroup()
	};

	it('sizes small during warmup then scales up once a positive edge is established', () => {
		const spec = baseSpec({ risk: kellyRisk, rules: kellyRules });
		// 70% win rate (7 of 10), interleaved so losses land inside the warmup window
		// → R is defined the moment warmup ends.
		const pattern = [true, true, true, false, true, true, false, true, true, false];
		const result = runBacktest(spec, { TEST: candles(cyclesFrom(pattern, 6)) });

		expect(result.trades.length).toBeGreaterThan(6);
		// The first 5 trades are sized by the conservative warmup fallback (identical,
		// small qty since equity barely moves over a few small trades).
		const warmupQty = result.trades[0].qty;
		expect(warmupQty).toBeGreaterThan(0);
		for (let i = 1; i < 5; i++) expect(result.trades[i].qty).toBe(warmupQty);
		// The 6th trade (entry sized once 5 trades have CLOSED) reflects the rolling
		// stat — W=0.8, R≈1 ⇒ f*≈0.6, ×0.5 ⇒ ~0.3 of equity — so it is far larger.
		const firstPostWarmup = result.trades[5].qty;
		expect(firstPostWarmup).toBeGreaterThan(warmupQty * 10);
		// And the rolling stat keeps driving non-trivial sizing on later entries.
		const lastQty = result.trades[result.trades.length - 1].qty;
		expect(lastQty).toBeGreaterThan(warmupQty);
	});

	it('a losing history drives f* to 0 → no sizing after warmup', () => {
		const spec = baseSpec({ risk: kellyRisk, rules: kellyRules });
		// Every cycle loses. After 5 losers settle, W=0 and avgWin=0 ⇒ f*=0 ⇒ every
		// subsequent entry sizes 0, so the trade count is capped near the warmup
		// window and never reaches one-per-cycle (20 cycles ⇒ would be 20 trades).
		const result = runBacktest(spec, { TEST: candles(cyclesFrom([false], 20)) });

		const losers = result.trades.filter((t) => t.pnl < 0);
		expect(losers.length).toBeGreaterThanOrEqual(5);
		expect(result.trades.every((t) => t.pnl < 0)).toBe(true);
		// Capped at the warmup trades — the negative edge halts further sizing.
		expect(result.trades.length).toBeLessThan(10);
	});

	it('is leak-free: Kelly stats read only CLOSED trades (gate passes)', () => {
		// The leak gate corrupts the future at every cut; a settled trade may not
		// change. Kelly sizing reads only already-closed-trade aggregates, so a
		// perturbed future cannot alter a past entry's size → the gate must pass.
		const spec = baseSpec({ risk: kellyRisk, rules: kellyRules });
		const data = { TEST: candles(cyclesFrom([true, true, false, true, true, false], 6)) };
		expect(() => assertNoLookahead(spec, data)).not.toThrow();
	});
});

describe('runBacktest — short borrow cost (§ costs)', () => {
	it('reduces a short trade pnl versus zero-APR on the same price path', () => {
		// Falls through 105 (short entry), keeps falling, then rises back through 95
		// (short exit). Identical price path; only shortBorrowAPR differs.
		const rules = {
			longEntry: emptyGroup(),
			longExit: emptyGroup(),
			shortEntry: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
			shortExit: group('AND', [binary(price('close'), 'crossover', constant(95))])
		};
		const data = { TEST: candles([110, 108, 104, 100, 96, 92, 94, 96, 98]) };

		const noBorrow = runBacktest(baseSpec({ rules }), data);
		const withBorrow = runBacktest(
			baseSpec({ rules, risk: { ...baseSpec().risk, shortBorrowAPR: 50 } }),
			data
		);

		expect(noBorrow.trades.length).toBe(1);
		expect(withBorrow.trades.length).toBe(1);
		const a = noBorrow.trades[0];
		const b = withBorrow.trades[0];
		// Same entry/exit fills (same price path) — only the borrow cost differs.
		expect(a.entryPrice).toBe(b.entryPrice);
		expect(a.exitPrice).toBe(b.exitPrice);
		expect(a.qty).toBe(b.qty);
		// Borrow cost strictly reduces the short's pnl.
		expect(b.pnl).toBeLessThan(a.pnl);

		// The reduction equals the accrued borrow: notional × (APR/100) ×
		// (timeframeSeconds/yr) × barsHeld. 1d = 86_400s; yr = 31_557_600s.
		const barsHeld = b.barsHeld;
		const perBar = (50 / 100) * (86_400 / 31_557_600);
		const expectedBorrow = b.entryPrice * b.qty * perBar * barsHeld;
		expect(a.pnl - b.pnl).toBeCloseTo(expectedBorrow, 6);
	});

	it('does not affect long trades', () => {
		const rules = {
			longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
			longExit: group('AND', [binary(price('close'), 'crossunder', constant(115))]),
			shortEntry: emptyGroup(),
			shortExit: emptyGroup()
		};
		const data = { TEST: candles([100, 104, 106, 110, 116, 120, 118, 114, 110]) };
		const noBorrow = runBacktest(baseSpec({ rules }), data);
		const withBorrow = runBacktest(
			baseSpec({ rules, risk: { ...baseSpec().risk, shortBorrowAPR: 50 } }),
			data
		);
		expect(noBorrow.trades.length).toBe(1);
		expect(withBorrow.trades.length).toBe(1);
		// Longs accrue no borrow cost, so pnl is identical.
		expect(withBorrow.trades[0].pnl).toBeCloseTo(noBorrow.trades[0].pnl, 9);
	});

	it('is leak-free with borrow accrued at close (gate passes over a zigzag)', () => {
		// Borrow cost depends only on bars held and entry notional (both known at
		// close from past bars), so corrupting the future leaves settled shorts
		// unchanged → the leak gate passes.
		const closes = Array.from({ length: 60 }, (_, i) => 105 + Math.sin(i / 2) * 7);
		const spec = baseSpec({
			risk: { ...baseSpec().risk, shortBorrowAPR: 50 },
			rules: {
				longEntry: emptyGroup(),
				longExit: emptyGroup(),
				shortEntry: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortExit: group('AND', [binary(price('close'), 'crossover', constant(105))])
			}
		});
		expect(() => assertNoLookahead(spec, { TEST: candles(closes) })).not.toThrow();
	});
});

describe('runBacktest — scale-out / partial profit (§4c)', () => {
	// Long entry: crossover 105 at idx2 (close 104→106), fills at open of idx3.
	// We hand-build bars so the runner up to known highs hits each scale-out level
	// on a specific bar, then a final down bar triggers the stop on the runner.
	// Entry fills at idx3 open = 100. Stop = 2% → 98. Scale-out: 5% (→105) then
	// 10% (→110) of entry. Levels close 40% then 30% of the 100-share original,
	// leaving a 30-share runner.
	const scaleRules = {
		longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
		longExit: emptyGroup(),
		shortEntry: emptyGroup(),
		shortExit: emptyGroup()
	};

	function scaleSeries(): Candle[] {
		// idx0/1 stay ≤105; idx2 closes 106 → crossover AT idx2. Entry fills at the
		// open of idx3, set to 100. Stop = 2% → 98. idx4 high 105 hits L1 (5% → 105),
		// idx5 high 110 hits L2 (10% → 110), idx6 low 90 hits the runner's 98 stop.
		return ohlc([
			[100, 104.5, 99.5, 104], // idx0 close 104 (≤105)
			[104, 104.5, 103.5, 104], // idx1 close 104 (≤105)
			[104, 106.5, 103.5, 106], // idx2 close 106 (>105) → crossover
			[100, 100.5, 99.5, 100], // idx3 entry fill bar, open 100
			[100, 105.0, 99.8, 104], // idx4 high 105 → L1 (5%) hit
			[104, 110.0, 103.5, 108], // idx5 high 110 → L2 (10%) hit
			[108, 108.5, 90.0, 95] // idx6 low 90 → runner stop @98
		]);
	}

	it('closes the right fractions at the right prices and leaves a runner that exits', () => {
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				positionSizing: { mode: 'fixedShares', shares: 100 },
				stopLoss: { mode: 'percent', percent: 2 },
				scaleOut: {
					levels: [
						{ trigger: { kind: 'percent', percent: 5 }, fraction: 0.4 },
						{ trigger: { kind: 'percent', percent: 10 }, fraction: 0.3 }
					]
				}
			},
			rules: scaleRules
		});
		const result = runBacktest(spec, { TEST: scaleSeries() });

		// Three trade records: two partials + the runner.
		expect(result.trades.length).toBe(3);
		const [p1, p2, runner] = result.trades;

		// Original qty 100 → 40 + 30 + 30 = 100.
		expect(p1.qty).toBe(40);
		expect(p2.qty).toBe(30);
		expect(runner.qty).toBe(30);
		expect(p1.qty + p2.qty + runner.qty).toBe(100);

		// Partials fill at the LEVEL price (entry 100 → +5% = 105, +10% = 110).
		expect(p1.exitPrice).toBe(105);
		expect(p1.exitReason).toBe('targetHit');
		expect(p2.exitPrice).toBe(110);
		expect(p2.exitReason).toBe('targetHit');

		// Runner is stopped out at the 2% stop (98).
		expect(runner.exitReason).toBe('stopHit');
		expect(runner.exitPrice).toBeCloseTo(98, 9);

		// pnl/cash consistency: each partial uses entry geometry (entry 100).
		expect(p1.pnl).toBeCloseTo((105 - 100) * 40, 9);
		expect(p2.pnl).toBeCloseTo((110 - 100) * 30, 9);
		expect(runner.pnl).toBeCloseTo((98 - 100) * 30, 9);
		// cumulativePnl threads through all three in order.
		expect(p1.cumulativePnl).toBeCloseTo(p1.pnl, 9);
		expect(p2.cumulativePnl).toBeCloseTo(p1.pnl + p2.pnl, 9);
		expect(runner.cumulativePnl).toBeCloseTo(p1.pnl + p2.pnl + runner.pnl, 9);
	});

	it('processes multiple levels reached in the SAME bar, ascending', () => {
		// A single bar rips through both the 5% and 10% levels at once.
		const series = ohlc([
			[100, 104.5, 99.5, 104], // idx0
			[104, 104.5, 103.5, 104], // idx1
			[104, 106.5, 103.5, 106], // idx2 → crossover
			[100, 100.5, 99.5, 100], // idx3 entry fill bar, open 100
			[100, 112.0, 99.8, 111], // idx4 high 112 → hits BOTH 105 and 110
			[111, 111.5, 110.5, 111] // idx5 quiet; runner rides to endOfData
		]);
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				positionSizing: { mode: 'fixedShares', shares: 100 },
				stopLoss: { mode: 'percent', percent: 2 },
				scaleOut: {
					levels: [
						{ trigger: { kind: 'percent', percent: 5 }, fraction: 0.4 },
						{ trigger: { kind: 'percent', percent: 10 }, fraction: 0.3 }
					]
				}
			},
			rules: scaleRules
		});
		const result = runBacktest(spec, { TEST: series });
		expect(result.trades.length).toBe(3);
		const [p1, p2, runner] = result.trades;
		expect(p1.exitPrice).toBe(105);
		expect(p2.exitPrice).toBe(110);
		expect(p1.qty).toBe(40);
		expect(p2.qty).toBe(30);
		expect(runner.qty).toBe(30);
		expect(runner.exitReason).toBe('endOfData');
	});

	it('default (no scaleOut) is unchanged: a single trade closes the whole position', () => {
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				positionSizing: { mode: 'fixedShares', shares: 100 },
				stopLoss: { mode: 'percent', percent: 2 }
			},
			rules: scaleRules
		});
		const result = runBacktest(spec, { TEST: scaleSeries() });
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].qty).toBe(100);
	});

	it('an rMultiple scale-out level fills at the R-target price', () => {
		// Stop 2% on entry 100 → risk 2/share. 2R level target = 100 + 2*2 = 104,
		// fraction 0.5 → close 50, runner 50 rides to endOfData.
		const series = ohlc([
			[100, 104.5, 99.5, 104], // idx0
			[104, 104.5, 103.5, 104], // idx1
			[104, 106.5, 103.5, 106], // idx2 → crossover
			[100, 100.5, 99.5, 100], // idx3 entry fill bar, open 100
			[100, 104.0, 99.8, 103], // idx4 high 104 → hits 2R target
			[103, 103.5, 102.5, 103] // idx5 quiet; runner to endOfData
		]);
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				positionSizing: { mode: 'fixedShares', shares: 100 },
				stopLoss: { mode: 'percent', percent: 2 },
				scaleOut: { levels: [{ trigger: { kind: 'rMultiple', r: 2 }, fraction: 0.5 }] }
			},
			rules: scaleRules
		});
		const result = runBacktest(spec, { TEST: series });
		expect(result.trades.length).toBe(2);
		const [p1, runner] = result.trades;
		expect(p1.qty).toBe(50);
		expect(p1.exitPrice).toBeCloseTo(104, 9);
		expect(p1.exitReason).toBe('targetHit');
		expect(runner.qty).toBe(50);
		expect(runner.exitReason).toBe('endOfData');
	});

	it('stop precedence: a bar hitting both the stop and a level fully exits at the stop', () => {
		// Entry 100, stop 98 (2%). The bar after entry both reaches the 5% level (105)
		// and breaks the stop (low 97): the conservative ordering exits the WHOLE
		// position at the stop and books no partial profit.
		const series = ohlc([
			[100, 104.5, 99.5, 104], // idx0
			[104, 104.5, 103.5, 104], // idx1
			[104, 106.5, 103.5, 106], // idx2 → crossover
			[100, 100.5, 99.5, 100], // idx3 entry fill bar
			[100, 106.0, 97.0, 99] // idx4 high 106 (≥105) AND low 97 (≤98 stop)
		]);
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				positionSizing: { mode: 'fixedShares', shares: 100 },
				stopLoss: { mode: 'percent', percent: 2 },
				scaleOut: { levels: [{ trigger: { kind: 'percent', percent: 5 }, fraction: 0.4 }] }
			},
			rules: scaleRules
		});
		const result = runBacktest(spec, { TEST: series });
		expect(result.trades.length).toBe(1);
		expect(result.trades[0].qty).toBe(100);
		expect(result.trades[0].exitReason).toBe('stopHit');
		expect(result.trades[0].exitPrice).toBeCloseTo(98, 9);
	});

	it('is leak-free: a scale-out run passes the leak gate', () => {
		const closes = Array.from({ length: 60 }, (_, i) => 105 + Math.sin(i / 2) * 7);
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				positionSizing: { mode: 'fixedShares', shares: 100 },
				stopLoss: { mode: 'percent', percent: 2 },
				scaleOut: {
					levels: [
						{ trigger: { kind: 'percent', percent: 3 }, fraction: 0.4 },
						{ trigger: { kind: 'rMultiple', r: 2 }, fraction: 0.3 }
					]
				}
			},
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', constant(105))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', constant(105))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		expect(() => assertNoLookahead(spec, { TEST: candles(closes) })).not.toThrow();
	});

	it('determinism holds with scale-out enabled', () => {
		const spec = baseSpec({
			risk: {
				...baseSpec().risk,
				positionSizing: { mode: 'fixedShares', shares: 100 },
				stopLoss: { mode: 'percent', percent: 2 },
				scaleOut: { levels: [{ trigger: { kind: 'percent', percent: 5 }, fraction: 0.4 }] }
			},
			rules: scaleRules
		});
		const data = { TEST: scaleSeries() };
		const a = normalize(runBacktest(spec, data));
		const b = normalize(runBacktest(spec, data));
		expect(a).toEqual(b);
	});
});

describe('runBacktest — multi-timeframe indicator reference (§3 / §4a)', () => {
	// Hourly base candles, anchored at UTC midnight, so they resample cleanly into
	// 4h higher-TF buckets (4 hourly bars per HTF bar).
	function hourlyCandles(closes: number[]): Candle[] {
		return closes.map((c, i) => {
			const o = i === 0 ? c : closes[i - 1];
			return {
				t: new Date(Date.UTC(2024, 0, 1 + Math.floor(i / 24), i % 24)).toISOString(),
				o,
				h: Math.max(o, c) + 0.5,
				l: Math.min(o, c) - 0.5,
				c,
				v: 1000
			};
		});
	}

	function mtfSpec(): StrategySpec {
		return baseSpec({
			universe: { ...baseSpec().universe, timeframe: '1h' },
			// Higher-TF EMA(3) on 4h bars, referenced on the 1h base bars.
			indicators: [
				{ id: 'ema_htf', type: 'ema', params: { period: 3 }, priceSource: 'close', timeframe: '4h' }
			],
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', indicator('ema_htf'))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', indicator('ema_htf'))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
	}

	it('aligns the HTF series to base bars using only the previous COMPLETED HTF bar', () => {
		// Drive the engine through the SAME precompute path by re-deriving the HTF EMA
		// independently and checking the engine trades only ever reference the closed bar.
		const closes = Array.from({ length: 48 }, (_, i) => 100 + Math.sin(i / 3) * 8);
		const base = hourlyCandles(closes);

		// Re-derive: resample 1h→4h (14400s), EMA(3), align back to base indices.
		const { bars, bucketEndMs } = resampleBySeconds(base, 14_400);
		const htfEma = ema(
			bars.map((b) => b.c),
			3
		);
		const aligned = alignToBase(
			base.map((c) => Date.parse(c.t)),
			htfEma,
			bucketEndMs
		);

		// Property: at any base bar t, the aligned value equals the EMA of the LAST
		// HTF bucket whose close time <= t — i.e. a fully closed bar, never the
		// forming one. Verify the alignment matches a direct "most-recent-closed" scan.
		for (let i = 0; i < base.length; i++) {
			const t = Date.parse(base[i].t);
			let lastClosed = -1;
			for (let k = 0; k < bucketEndMs.length; k++) {
				if (bucketEndMs[k] <= t) lastClosed = k;
				else break;
			}
			const expected = lastClosed >= 0 ? htfEma[lastClosed] : NaN;
			if (Number.isNaN(expected)) {
				expect(Number.isNaN(aligned[i])).toBe(true);
			} else {
				expect(aligned[i]).toBe(expected);
			}
			// The value at base bar i is NEVER the EMA of a bucket that closes AFTER t
			// (the forming/future bar): the engine cannot have seen it.
			for (let k = 0; k < bucketEndMs.length; k++) {
				if (bucketEndMs[k] > t && Number.isFinite(htfEma[k]) && Number.isFinite(aligned[i])) {
					// Only assert distinctness when the future bucket's value actually differs.
					if (htfEma[k] !== expected) expect(aligned[i]).not.toBe(htfEma[k]);
				}
			}
		}
	});

	it('a higher-TF strategy is leak-free (gate passes)', () => {
		const closes = Array.from({ length: 96 }, (_, i) => 100 + Math.sin(i / 4) * 10);
		expect(() => assertNoLookahead(mtfSpec(), { TEST: hourlyCandles(closes) })).not.toThrow();
	});

	it('settled trades are invariant to mutating future bars (perturbAfter style)', () => {
		const closes = Array.from({ length: 96 }, (_, i) => 100 + Math.sin(i / 4) * 10);
		const base = hourlyCandles(closes);
		const spec = mtfSpec();

		const baseline = runBacktest(spec, { TEST: base }).trades;
		const timeToIndex = new Map(base.map((c, i) => [c.t, i]));
		expect(baseline.length).toBeGreaterThan(0);

		// At several interior cuts, corrupt all bars after the cut and confirm every
		// trade fully SETTLED on/before the cut is byte-identical to the clean run.
		for (const cut of [30, 45, 60, 75]) {
			const perturbed = runBacktest(spec, { TEST: perturbAfter(base, cut) }).trades;
			const settledBaseline = baseline.filter(
				(t) => (timeToIndex.get(t.exitTime) ?? Infinity) <= cut
			);
			const settledPerturbed = perturbed.filter(
				(t) => (timeToIndex.get(t.exitTime) ?? Infinity) <= cut
			);
			expect(settledPerturbed.length).toBe(settledBaseline.length);
			for (let i = 0; i < settledBaseline.length; i++) {
				expect(settledPerturbed[i].entryTime).toBe(settledBaseline[i].entryTime);
				expect(settledPerturbed[i].entryPrice).toBe(settledBaseline[i].entryPrice);
				expect(settledPerturbed[i].exitTime).toBe(settledBaseline[i].exitTime);
				expect(settledPerturbed[i].exitPrice).toBe(settledBaseline[i].exitPrice);
				expect(settledPerturbed[i].pnl).toBeCloseTo(settledBaseline[i].pnl, 9);
			}
		}
	});

	it('treats a non-higher timeframe (equal/omitted) as the base path', () => {
		const closes = Array.from({ length: 48 }, (_, i) => 100 + Math.sin(i / 3) * 8);
		const base = hourlyCandles(closes);
		// timeframe '1h' equals the universe TF → identical to omitting it.
		const withEqual = baseSpec({
			universe: { ...baseSpec().universe, timeframe: '1h' },
			indicators: [
				{ id: 'e', type: 'ema', params: { period: 5 }, priceSource: 'close', timeframe: '1h' }
			],
			rules: {
				longEntry: group('AND', [binary(price('close'), 'crossover', indicator('e'))]),
				longExit: group('AND', [binary(price('close'), 'crossunder', indicator('e'))]),
				shortEntry: emptyGroup(),
				shortExit: emptyGroup()
			}
		});
		const withOmitted = baseSpec({
			universe: { ...baseSpec().universe, timeframe: '1h' },
			indicators: [{ id: 'e', type: 'ema', params: { period: 5 }, priceSource: 'close' }],
			rules: withEqual.rules
		});
		const a = normalize(runBacktest(withEqual, { TEST: base }));
		const b = normalize(runBacktest(withOmitted, { TEST: base }));
		expect(a.trades).toEqual(b.trades);
	});
});
