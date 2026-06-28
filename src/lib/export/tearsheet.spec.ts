import { describe, expect, it } from 'vitest';
import { buildTearsheetHtml, equitySvg, escapeHtml, metricsTableHtml } from './tearsheet';
import type { BacktestResult, MetricValue, StrategySpec, Trade } from '$lib/types';

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
			commission: { mode: 'perTrade', perTrade: 1 },
			slippage: { mode: 'percent', percent: 0.001 }
		},
		execution: { fillOn: 'nextOpen', orderType: 'market' }
	};
}

function makeResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
	return {
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
			},
			{
				id: 'finalEquity',
				label: 'Final equity',
				value: 125000,
				format: 'currency',
				group: 'returns'
			}
		],
		equityCurve: [
			{ t: '2024-01-02T14:30:00.000Z', equity: 100000 },
			{ t: '2024-01-03T20:00:00.000Z', equity: 100100 },
			{ t: '2024-01-04T20:00:00.000Z', equity: 125000 }
		],
		drawdown: [
			{ t: '2024-01-02T14:30:00.000Z', drawdown: 0 },
			{ t: '2024-01-03T20:00:00.000Z', drawdown: -0.01 }
		],
		trades: [makeTrade(), makeTrade({ id: 't2', pnl: -25, side: 'short' })],
		monthlyReturns: [
			{ year: 2024, month: 1, returnPct: 0.05 },
			{ year: 2024, month: 2, returnPct: -0.02 }
		],
		distribution: [{ lower: -0.1, upper: 0, count: 1 }],
		warnings: ['heads up'],
		computedAt: '2024-12-31T00:00:00.000Z',
		...overrides
	};
}

describe('escapeHtml', () => {
	it('escapes the five HTML metacharacters', () => {
		expect(escapeHtml('<script>alert("x")</script>')).toBe(
			'&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
		);
		expect(escapeHtml("a & b ' c")).toBe('a &amp; b &#39; c');
	});

	it('leaves plain text untouched', () => {
		expect(escapeHtml('Mean Reversion v2')).toBe('Mean Reversion v2');
	});
});

describe('metricsTableHtml', () => {
	it('formats a pct metric with % and a currency metric with $', () => {
		const metrics: MetricValue[] = [
			{ id: 'tr', label: 'Total return', value: 0.25, format: 'pct', group: 'returns' },
			{ id: 'fe', label: 'Final equity', value: 125000, format: 'currency', group: 'returns' }
		];
		const html = metricsTableHtml(metrics);
		expect(html).toContain('25.00%');
		expect(html).toContain('$125,000');
		expect(html).toContain('Total return');
	});

	it('renders group headers and an empty state', () => {
		const html = metricsTableHtml([
			{ id: 's', label: 'Sharpe', value: 1.4, format: 'ratio', group: 'risk' }
		]);
		expect(html).toContain('Risk');
		expect(html).toContain('1.40');
		expect(metricsTableHtml([])).toContain('No metrics');
	});

	it('escapes a malicious metric label', () => {
		const html = metricsTableHtml([
			{ id: 'x', label: '<img src=x onerror=alert(1)>', value: 1, format: 'int', group: 'trade' }
		]);
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
	});
});

describe('equitySvg', () => {
	it('returns an <svg> for points', () => {
		const svg = equitySvg([
			{ t: '2024-01-02T14:30:00.000Z', equity: 100 },
			{ t: '2024-01-03T20:00:00.000Z', equity: 110 }
		]);
		expect(svg).toContain('<svg');
		expect(svg).toContain('<polyline');
		expect(svg).toContain('points="');
	});

	it('returns an empty state for no points', () => {
		const svg = equitySvg([]);
		expect(svg).not.toContain('<svg');
		expect(svg).toContain('No equity data');
	});

	it('handles a flat series without dividing by zero', () => {
		const svg = equitySvg([
			{ t: 'a', equity: 50 },
			{ t: 'b', equity: 50 }
		]);
		expect(svg).toContain('<polyline');
		expect(svg).not.toContain('NaN');
	});
});

describe('buildTearsheetHtml', () => {
	it('produces a self-contained document with the key sections', () => {
		const html = buildTearsheetHtml(makeResult());
		expect(html.toLowerCase().startsWith('<!doctype html')).toBe(true);
		expect(html).toContain('My Strategy');
		expect(html).toContain('25.00%'); // a metrics value
		expect(html).toContain('<svg'); // equity + drawdown charts
		expect(html).toContain('nextOpen'); // audit fill model
		expect(html).toContain('+5.00%'); // a monthly cell
		expect(html).toContain('heads up'); // warning
		expect(html).toContain('</html>');
	});

	it('derives the trade summary from the trades', () => {
		const html = buildTearsheetHtml(makeResult());
		// 2 trades, 1 win → win rate 50%, net 100 + (-25) = +$75
		expect(html).toContain('50.00%');
		expect(html).toContain('+$75');
	});

	it('does not emit a malicious strategy name raw (XSS guard)', () => {
		const spec = makeSpec();
		spec.name = '<script>alert("pwn")</script>';
		const html = buildTearsheetHtml(makeResult({ spec }));
		expect(html).not.toContain('<script>alert("pwn")</script>');
		expect(html).toContain('&lt;script&gt;alert(&quot;pwn&quot;)&lt;/script&gt;');
	});

	it('includes a validation section when provided', () => {
		const html = buildTearsheetHtml(makeResult(), {
			validationHtml: '<p>All checks passed</p>'
		});
		expect(html).toContain('Validation');
		expect(html).toContain('All checks passed');
	});

	it('renders empty states for a result with no data', () => {
		const empty = makeResult({
			metrics: [],
			equityCurve: [],
			drawdown: [],
			monthlyReturns: [],
			trades: [],
			warnings: []
		});
		const html = buildTearsheetHtml(empty);
		expect(html).toContain('No metrics');
		expect(html).toContain('No equity data');
		expect(html).toContain('No warnings');
		expect(html.toLowerCase().startsWith('<!doctype html')).toBe(true);
	});
});
