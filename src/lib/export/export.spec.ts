import { describe, expect, it } from 'vitest';
import { tradesToCsv, csvField } from './csv';
import { buildFilename } from './filename';
import { buildWorkbook } from './xlsx';
import { resultToJson } from './json';
import { computeTotals } from './ledger';
import type { BacktestResult, StrategySpec, Trade } from '$lib/types';

function makeTrade(overrides: Partial<Trade> = {}): Trade {
	return {
		id: 't1',
		ticker: 'AAPL',
		side: 'long',
		entryTime: '2024-01-02T14:30:00.000Z',
		entryPrice: 100,
		exitTime: '2024-01-03T20:00:00.000Z',
		exitPrice: 110,
		qty: 10,
		stopPrice: 95,
		targetPrice: 120,
		pnl: 100,
		pnlPct: 0.1,
		rMultiple: 2,
		cumulativePnl: 100,
		mae: -0.02,
		mfe: 0.12,
		exitReason: 'targetHit',
		barsHeld: 5,
		...overrides
	};
}

function makeSpec(overrides: Partial<StrategySpec['universe']> = {}): StrategySpec {
	return {
		schemaVersion: 1,
		name: 'My Strategy',
		universe: {
			tickers: ['AAPL'],
			timeframe: '1d',
			dateRange: { from: '2024-01-01', to: '2024-12-31' },
			session: { kind: 'RTH' },
			...overrides
		},
		indicators: [],
		rules: {
			longEntry: { kind: 'group', id: 'g1', logic: 'AND', children: [] },
			longExit: { kind: 'group', id: 'g2', logic: 'AND', children: [] },
			shortEntry: { kind: 'group', id: 'g3', logic: 'AND', children: [] },
			shortExit: { kind: 'group', id: 'g4', logic: 'AND', children: [] }
		},
		risk: {
			initialCapital: 100000,
			positionSizing: { mode: 'fixedShares', shares: 10 },
			stopLoss: { mode: 'none' },
			takeProfit: { mode: 'none' },
			trailingStop: { mode: 'none' },
			maxConcurrentPositions: 1,
			pyramiding: 0,
			commission: { mode: 'none' },
			slippage: { mode: 'none' }
		},
		execution: { fillOn: 'nextOpen', orderType: 'market' }
	};
}

describe('csvField (RFC-4180 quoting)', () => {
	it('leaves plain fields unquoted', () => {
		expect(csvField('AAPL')).toBe('AAPL');
		expect(csvField('123.45')).toBe('123.45');
		expect(csvField('')).toBe('');
	});

	it('quotes fields containing a comma', () => {
		expect(csvField('a,b')).toBe('"a,b"');
	});

	it('quotes and doubles embedded double-quotes', () => {
		expect(csvField('say "hi"')).toBe('"say ""hi"""');
		expect(csvField('"')).toBe('""""');
	});

	it('quotes fields containing CR or LF', () => {
		expect(csvField('line1\nline2')).toBe('"line1\nline2"');
		expect(csvField('a\r\nb')).toBe('"a\r\nb"');
	});
});

describe('tradesToCsv', () => {
	it('emits a header row and CRLF line breaks', () => {
		const csv = tradesToCsv([makeTrade()]);
		const lines = csv.split('\r\n');
		// header + 1 trade + trailing empty (from final CRLF)
		expect(lines[0].startsWith('#,Side,Ticker,Entry date')).toBe(true);
		expect(lines).toHaveLength(3);
		expect(lines[2]).toBe('');
	});

	it('writes ISO-8601 timestamps and raw numbers', () => {
		const csv = tradesToCsv([makeTrade()]);
		const row = csv.split('\r\n')[1];
		expect(row).toContain('2024-01-02T14:30:00.000Z');
		expect(row).toContain('2024-01-03T20:00:00.000Z');
		// raw P&L number, not currency-formatted
		expect(row).toContain('100');
		expect(row).not.toContain('$');
	});

	it('escapes a ticker containing a comma', () => {
		const csv = tradesToCsv([makeTrade({ ticker: 'BRK,B' })]);
		const row = csv.split('\r\n')[1];
		expect(row).toContain('"BRK,B"');
	});

	it('emits an empty field for a null stop/target price', () => {
		const csv = tradesToCsv([makeTrade({ stopPrice: null, targetPrice: null })]);
		const header = csv.split('\r\n')[0].split(',');
		const row = csv.split('\r\n')[1].split(',');
		const stopIdx = header.indexOf('Stop price');
		const targetIdx = header.indexOf('Target price');
		expect(row[stopIdx]).toBe('');
		expect(row[targetIdx]).toBe('');
	});
});

describe('buildFilename', () => {
	it('uses the single ticker', () => {
		expect(buildFilename(makeSpec(), 'csv')).toBe('My_Strategy_AAPL_2024-01-01_2024-12-31.csv');
	});

	it("uses 'portfolio' for multiple tickers", () => {
		const spec = makeSpec({ tickers: ['AAPL', 'MSFT'] });
		expect(buildFilename(spec, 'xlsx')).toBe('My_Strategy_portfolio_2024-01-01_2024-12-31.xlsx');
	});

	it('sanitizes unsafe characters to underscores', () => {
		const spec = makeSpec();
		spec.name = 'Mean / Reversion: v2 (beta)!';
		const name = buildFilename(spec, 'csv');
		expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
		expect(name).toContain('Mean_Reversion_v2_beta');
	});

	it('falls back to a placeholder when a segment is entirely unsafe', () => {
		const spec = makeSpec({ tickers: ['@@@'] });
		spec.name = '***';
		const name = buildFilename(spec, 'csv');
		expect(name).toBe('untitled_untitled_2024-01-01_2024-12-31.csv');
	});
});

describe('computeTotals', () => {
	it('aggregates wins, losses, and profit factor', () => {
		const trades = [
			makeTrade({ pnl: 100, rMultiple: 2 }),
			makeTrade({ pnl: -50, rMultiple: -1 }),
			makeTrade({ pnl: 30, rMultiple: 0.6 })
		];
		const t = computeTotals(trades);
		expect(t.totalTrades).toBe(3);
		expect(t.wins).toBe(2);
		expect(t.losses).toBe(1);
		expect(t.net).toBe(80);
		expect(t.grossWin).toBe(130);
		expect(t.grossLoss).toBe(-50);
		expect(t.profitFactor).toBeCloseTo(2.6);
		expect(t.winRate).toBeCloseTo(2 / 3);
		expect(t.largestWin).toBe(100);
		expect(t.largestLoss).toBe(-50);
	});

	it('returns NaN-driven sentinels for an empty set', () => {
		const t = computeTotals([]);
		expect(t.totalTrades).toBe(0);
		expect(Number.isNaN(t.winRate)).toBe(true);
		expect(Number.isNaN(t.profitFactor)).toBe(true);
	});
});

describe('resultToJson', () => {
	const baseResult: BacktestResult = {
		runId: 'run-1',
		spec: makeSpec(),
		metrics: [
			{
				id: 'totalReturn',
				label: 'Total return',
				value: 0.25,
				format: 'pct',
				group: 'returns',
				betterWhenHigher: true
			}
		],
		equityCurve: [{ t: '2024-01-02T14:30:00.000Z', equity: 100000 }],
		drawdown: [{ t: '2024-01-02T14:30:00.000Z', drawdown: 0 }],
		trades: [makeTrade(), makeTrade({ id: 't2', pnl: -25, side: 'short' })],
		monthlyReturns: [{ year: 2024, month: 1, returnPct: 0.05 }],
		distribution: [{ lower: -0.1, upper: 0, count: 1 }],
		warnings: ['heads up'],
		audit: {
			fillModel: 'nextOpen',
			orderType: 'market',
			commissionMode: 'none',
			slippageMode: 'none',
			initialCapital: 100000,
			liquidityCapPct: null,
			timeframe: '1d',
			bars: 1,
			tickers: ['AAPL'],
			lookaheadOptimistic: false,
			schemaVersion: 1,
			computedAt: '2024-12-31T00:00:00.000Z'
		},
		computedAt: '2024-12-31T00:00:00.000Z'
	};

	it('round-trips the full result losslessly with the visible trades', () => {
		const visible = [makeTrade()];
		const parsed = JSON.parse(resultToJson(baseResult, visible)) as BacktestResult;
		expect(parsed.runId).toBe('run-1');
		expect(parsed.metrics).toEqual(baseResult.metrics);
		expect(parsed.equityCurve).toEqual(baseResult.equityCurve);
		expect(parsed.warnings).toEqual(['heads up']);
		// Trades reflect the passed-in (filtered/sorted) view, not the original.
		expect(parsed.trades).toHaveLength(1);
		expect(parsed.trades[0].id).toBe('t1');
	});

	it('does not mutate the original result', () => {
		resultToJson(baseResult, []);
		expect(baseResult.trades).toHaveLength(2);
	});

	it('pretty-prints with two-space indentation', () => {
		const json = resultToJson(baseResult, []);
		expect(json).toContain('\n  "runId": "run-1"');
	});
});

describe('buildWorkbook (smoke)', () => {
	it('returns a non-empty ArrayBuffer for a small fixture', async () => {
		const result: BacktestResult = {
			runId: 'run-1',
			spec: makeSpec(),
			metrics: [
				{
					id: 'totalReturn',
					label: 'Total return',
					value: 0.25,
					format: 'pct',
					group: 'returns',
					betterWhenHigher: true
				},
				{
					id: 'sharpe',
					label: 'Sharpe',
					value: 1.4,
					format: 'ratio',
					group: 'risk',
					betterWhenHigher: true
				}
			],
			equityCurve: [
				{ t: '2024-01-02T14:30:00.000Z', equity: 100000 },
				{ t: '2024-01-03T20:00:00.000Z', equity: 100100 }
			],
			drawdown: [
				{ t: '2024-01-02T14:30:00.000Z', drawdown: 0 },
				{ t: '2024-01-03T20:00:00.000Z', drawdown: -0.01 }
			],
			trades: [makeTrade(), makeTrade({ id: 't2', pnl: -25, side: 'short' })],
			monthlyReturns: [{ year: 2024, month: 1, returnPct: 0.05 }],
			distribution: [{ lower: -0.1, upper: 0, count: 1 }],
			warnings: [],
			audit: {
				fillModel: 'nextOpen',
				orderType: 'market',
				commissionMode: 'none',
				slippageMode: 'none',
				initialCapital: 100000,
				liquidityCapPct: null,
				timeframe: '1d',
				bars: 2,
				tickers: ['AAPL'],
				lookaheadOptimistic: false,
				schemaVersion: 1,
				computedAt: '2024-12-31T00:00:00.000Z'
			},
			computedAt: '2024-12-31T00:00:00.000Z'
		};

		const buffer = await buildWorkbook(result);
		expect(buffer).toBeInstanceOf(ArrayBuffer);
		expect(buffer.byteLength).toBeGreaterThan(0);

		// xlsx is a zip — verify the PK signature.
		const head = new Uint8Array(buffer.slice(0, 2));
		expect(head[0]).toBe(0x50); // 'P'
		expect(head[1]).toBe(0x4b); // 'K'
	});
});
