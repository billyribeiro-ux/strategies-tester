import { describe, it, expect } from 'vitest';
import type { DrawdownPoint, EquityPoint, ExitReason, Trade, TradeSide } from '$lib/types';
import {
	cvar,
	ulcerIndex,
	timeUnderwater,
	longestLosingStreak,
	calmar,
	omega,
	alphaBeta,
	attribution,
	regimeByYear,
	computeAnalytics
} from './analytics';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const eq = (t: string, equity: number): EquityPoint => ({ t, equity });
const dd = (t: string, drawdown: number): DrawdownPoint => ({ t, drawdown });

let tradeSeq = 0;
function trade(over: Partial<Trade> = {}): Trade {
	tradeSeq++;
	return {
		id: `t${tradeSeq}`,
		ticker: 'AAA',
		side: 'long' as TradeSide,
		entryTime: '2024-01-01T00:00:00Z',
		entryPrice: 100,
		exitTime: '2024-01-02T00:00:00Z',
		exitPrice: 100,
		qty: 1,
		stopPrice: null,
		targetPrice: null,
		pnl: 0,
		pnlPct: 0,
		rMultiple: 0,
		cumulativePnl: 0,
		mae: 0,
		mfe: 0,
		exitReason: 'signalExit' as ExitReason,
		barsHeld: 1,
		...over
	};
}

// ---------------------------------------------------------------------------
// cvar
// ---------------------------------------------------------------------------

describe('cvar', () => {
	it('averages the worst alpha-tail of returns (negative for losses)', () => {
		const returns = [-0.1, -0.05, 0.0, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08];
		// percentile(0.2) = -0.01 → tail = [-0.10, -0.05] → mean = -0.075
		expect(cvar(returns, 0.2)).toBeCloseTo(-0.075, 10);
	});

	it('returns 0 on empty input', () => {
		expect(cvar([])).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// ulcerIndex
// ---------------------------------------------------------------------------

describe('ulcerIndex', () => {
	it('is 0 for a monotonically rising curve', () => {
		const equity = [
			eq('2024-01-01T00:00:00Z', 100),
			eq('2024-01-02T00:00:00Z', 110),
			eq('2024-01-03T00:00:00Z', 120)
		];
		expect(ulcerIndex(equity)).toBeCloseTo(0, 10);
	});

	it('computes sqrt(mean(drawdownPct^2))', () => {
		// peaks: 100,100,100 → ddPct: 0, -10%, -20% → sqrt((0+100+400)/3)
		const equity = [
			eq('2024-01-01T00:00:00Z', 100),
			eq('2024-01-02T00:00:00Z', 90),
			eq('2024-01-03T00:00:00Z', 80)
		];
		expect(ulcerIndex(equity)).toBeCloseTo(Math.sqrt(500 / 3), 10);
	});

	it('returns 0 on empty input', () => {
		expect(ulcerIndex([])).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// timeUnderwater
// ---------------------------------------------------------------------------

describe('timeUnderwater', () => {
	it('finds the longest consecutive underwater run and the underwater fraction', () => {
		const drawdown = [
			dd('2024-01-01T00:00:00Z', 0),
			dd('2024-01-02T00:00:00Z', -0.1),
			dd('2024-01-03T00:00:00Z', -0.2),
			dd('2024-01-04T00:00:00Z', 0),
			dd('2024-01-05T00:00:00Z', -0.05)
		];
		const r = timeUnderwater(drawdown);
		expect(r.longestBars).toBe(2);
		expect(r.fraction).toBeCloseTo(3 / 5, 10);
	});

	it('returns safe zeros on empty input', () => {
		expect(timeUnderwater([])).toEqual({ longestBars: 0, fraction: 0 });
	});
});

// ---------------------------------------------------------------------------
// longestLosingStreak
// ---------------------------------------------------------------------------

describe('longestLosingStreak', () => {
	it('counts max consecutive losers in chronological order', () => {
		const trades = [
			trade({ entryTime: '2024-01-05T00:00:00Z', pnl: -1 }),
			trade({ entryTime: '2024-01-01T00:00:00Z', pnl: 5 }),
			trade({ entryTime: '2024-01-02T00:00:00Z', pnl: -2 }),
			trade({ entryTime: '2024-01-03T00:00:00Z', pnl: -3 }),
			trade({ entryTime: '2024-01-04T00:00:00Z', pnl: 1 })
		];
		// chronological pnl: +5, -2, -3, +1, -1 → longest losing run = 2
		expect(longestLosingStreak(trades)).toBe(2);
	});

	it('returns 0 on empty input', () => {
		expect(longestLosingStreak([])).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// calmar
// ---------------------------------------------------------------------------

describe('calmar', () => {
	it('is cagr / |maxDrawdown|', () => {
		expect(calmar(0.2, -0.1)).toBeCloseTo(2, 10);
		expect(calmar(0.2, 0.1)).toBeCloseTo(2, 10);
	});

	it('is 0 when maxDrawdown is 0', () => {
		expect(calmar(0.2, 0)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// omega
// ---------------------------------------------------------------------------

describe('omega', () => {
	it('is sum(gains) / |sum(losses)| about the threshold', () => {
		// gains above 0: 1 + 2 + 3 = 6; losses below 0: 1 + 2 = 3 → 2
		expect(omega([1, 2, 3, -1, -2])).toBeCloseTo(2, 10);
	});

	it('returns 0 on empty input', () => {
		expect(omega([])).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// alphaBeta
// ---------------------------------------------------------------------------

describe('alphaBeta', () => {
	it('recovers beta≈2, alpha≈0 when strategy = 2*benchmark', () => {
		const bench = [0.01, -0.02, 0.03, -0.01, 0.02];
		const strat = bench.map((b) => 2 * b);
		const { alpha, beta } = alphaBeta(strat, bench);
		expect(beta).toBeCloseTo(2, 10);
		expect(alpha).toBeCloseTo(0, 10);
	});

	it('uses the min length on mismatch and returns safe zeros on empty', () => {
		const r = alphaBeta([0.01, 0.02, 0.03], [0.02, 0.04]); // truncated to 2 → strat = 2*bench
		expect(r.beta).toBeCloseTo(0.5, 10);
		expect(alphaBeta([], [])).toEqual({ alpha: 0, beta: 0 });
	});
});

// ---------------------------------------------------------------------------
// attribution
// ---------------------------------------------------------------------------

describe('attribution', () => {
	it('groups by symbol, side and exit reason with count/netPnl/wins/winRate', () => {
		const trades = [
			trade({ ticker: 'AAA', side: 'long', exitReason: 'targetHit', pnl: 10 }),
			trade({ ticker: 'AAA', side: 'short', exitReason: 'stopHit', pnl: -4 }),
			trade({ ticker: 'BBB', side: 'long', exitReason: 'targetHit', pnl: 6 })
		];
		const a = attribution(trades);
		expect(a.bySymbol.AAA).toEqual({ count: 2, netPnl: 6, wins: 1, winRate: 0.5 });
		expect(a.bySymbol.BBB).toEqual({ count: 1, netPnl: 6, wins: 1, winRate: 1 });
		expect(a.bySide.long).toEqual({ count: 2, netPnl: 16, wins: 2, winRate: 1 });
		expect(a.bySide.short).toEqual({ count: 1, netPnl: -4, wins: 0, winRate: 0 });
		expect(a.byExitReason.targetHit).toEqual({ count: 2, netPnl: 16, wins: 2, winRate: 1 });
		expect(a.byExitReason.stopHit).toEqual({ count: 1, netPnl: -4, wins: 0, winRate: 0 });
	});

	it('returns empty maps on empty input', () => {
		expect(attribution([])).toEqual({ bySymbol: {}, bySide: {}, byExitReason: {} });
	});
});

// ---------------------------------------------------------------------------
// regimeByYear
// ---------------------------------------------------------------------------

describe('regimeByYear', () => {
	it('computes first-vs-last equity return per calendar year', () => {
		const equity = [
			eq('2023-01-01T00:00:00Z', 100),
			eq('2023-06-01T00:00:00Z', 120),
			eq('2023-12-31T00:00:00Z', 110), // 2023: 100 → 110 = +10%
			eq('2024-01-01T00:00:00Z', 110),
			eq('2024-12-31T00:00:00Z', 132) // 2024: 110 → 132 = +20%
		];
		const r = regimeByYear(equity);
		expect(r).toHaveLength(2);
		expect(r[0]).toEqual({ year: 2023, returnPct: expect.closeTo(0.1, 10) });
		expect(r[1]).toEqual({ year: 2024, returnPct: expect.closeTo(0.2, 10) });
	});

	it('returns empty on empty input', () => {
		expect(regimeByYear([])).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// computeAnalytics
// ---------------------------------------------------------------------------

describe('computeAnalytics', () => {
	it('produces no NaN on a normal fixture', () => {
		const equity = [
			eq('2024-01-01T00:00:00Z', 100),
			eq('2024-01-02T00:00:00Z', 95),
			eq('2024-01-03T00:00:00Z', 105)
		];
		const drawdown = [
			dd('2024-01-01T00:00:00Z', 0),
			dd('2024-01-02T00:00:00Z', -0.05),
			dd('2024-01-03T00:00:00Z', 0)
		];
		const trades = [
			trade({ pnl: -5, pnlPct: -0.05 }),
			trade({ pnl: 10, pnlPct: 0.1, side: 'short' })
		];
		const a = computeAnalytics({
			trades,
			equity,
			drawdown,
			tradeReturns: [-0.05, 0.1],
			cagr: 0.2,
			maxDrawdown: -0.05,
			benchmarkReturns: [-0.025, 0.05]
		});
		const scalars = [
			a.cvar,
			a.ulcerIndex,
			a.timeUnderwater.longestBars,
			a.timeUnderwater.fraction,
			a.longestLosingStreak,
			a.calmar,
			a.omega,
			a.alphaBeta.alpha,
			a.alphaBeta.beta
		];
		for (const v of scalars) expect(Number.isNaN(v)).toBe(false);
		expect(a.regimeByYear.every((r) => !Number.isNaN(r.returnPct))).toBe(true);
		expect(a.calmar).toBeCloseTo(4, 10); // 0.2 / 0.05
	});

	it('returns safe zeros on fully empty input', () => {
		const a = computeAnalytics({
			trades: [],
			equity: [],
			drawdown: [],
			tradeReturns: [],
			cagr: 0,
			maxDrawdown: 0
		});
		expect(a).toEqual({
			cvar: 0,
			ulcerIndex: 0,
			timeUnderwater: { longestBars: 0, fraction: 0 },
			longestLosingStreak: 0,
			calmar: 0,
			omega: 0,
			alphaBeta: { alpha: 0, beta: 0 },
			attribution: { bySymbol: {}, bySide: {}, byExitReason: {} },
			regimeByYear: []
		});
	});
});
