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
import { trueRange, wilderSmooth } from './series';

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
