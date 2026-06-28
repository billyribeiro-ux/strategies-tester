/**
 * Self-contained HTML tearsheet generator (spec §9 reporting).
 *
 * Produces a single, dependency-free HTML document that captures a full backtest
 * run — header, key metrics, equity/drawdown sparklines (inline SVG), monthly
 * returns, a trade summary, the run's warnings, and an audit block describing
 * how fills/costs were modelled. Every user-supplied string is HTML-escaped, so
 * the output is safe to write to disk and open in any browser.
 *
 * Pure string building (deterministic — no clock, no randomness; `computedAt`
 * comes from the result). The only side effect lives in `exportTearsheet`, which
 * wraps the HTML in a Blob and hands it to the shared browser download helper.
 */

import type {
	BacktestResult,
	DrawdownPoint,
	EquityPoint,
	MetricGroup,
	MetricValue,
	MonthlyReturn,
	Trade
} from '$lib/types';
import {
	formatCurrency,
	formatDate,
	formatDateTime,
	formatMetric,
	formatPercent,
	formatSignedCurrency,
	formatSignedPercent
} from '$lib/utils/format';
import { downloadBlob } from './download';

const HTML_ENTITIES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

/** Escape `& < > " '` so an arbitrary string is safe inside HTML text or attributes. */
export function escapeHtml(s: string): string {
	return String(s).replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

const GROUP_LABELS: Record<MetricGroup, string> = {
	returns: 'Returns',
	risk: 'Risk',
	trade: 'Trade'
};

const GROUP_ORDER: readonly MetricGroup[] = ['returns', 'risk', 'trade'] as const;

/**
 * Render the metrics as an HTML table, grouped by `MetricValue.group` and
 * formatted according to each metric's declared `format`. Groups appear in a
 * stable order (returns, risk, trade) followed by any unknown groups.
 */
export function metricsTableHtml(metrics: MetricValue[]): string {
	if (metrics.length === 0) {
		return '<p class="empty">No metrics reported.</p>';
	}

	const byGroup = new Map<string, MetricValue[]>();
	for (const metric of metrics) {
		const bucket = byGroup.get(metric.group);
		if (bucket) bucket.push(metric);
		else byGroup.set(metric.group, [metric]);
	}

	const orderedGroups: string[] = [
		...GROUP_ORDER.filter((g) => byGroup.has(g)),
		...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g as MetricGroup))
	];

	const rows: string[] = [];
	for (const group of orderedGroups) {
		const label = GROUP_LABELS[group as MetricGroup] ?? group;
		rows.push(
			`<tr class="group-row"><th colspan="2" scope="colgroup">${escapeHtml(label)}</th></tr>`
		);
		for (const metric of byGroup.get(group) ?? []) {
			const value = escapeHtml(formatMetric(metric.value, metric.format));
			rows.push(`<tr><th scope="row">${escapeHtml(metric.label)}</th><td>${value}</td></tr>`);
		}
	}

	return `<table class="metrics"><tbody>${rows.join('')}</tbody></table>`;
}

/** Map a finite numeric series to an SVG polyline path within the given box. */
function seriesPath(values: number[], width: number, height: number, pad: number): string {
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min;
	const innerW = width - pad * 2;
	const innerH = height - pad * 2;
	const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;

	return values
		.map((v, i) => {
			const x = pad + i * stepX;
			// Flat series: pin to the vertical centre rather than dividing by zero.
			const norm = span === 0 ? 0.5 : (v - min) / span;
			const y = pad + (1 - norm) * innerH;
			return `${x.toFixed(2)},${y.toFixed(2)}`;
		})
		.join(' ');
}

/**
 * Minimal inline SVG line chart of an equity curve — no external dependencies.
 * Returns empty-state markup when there are no points.
 */
export function equitySvg(equity: EquityPoint[], width = 720, height = 200): string {
	if (equity.length === 0) {
		return '<p class="empty">No equity data.</p>';
	}

	const pad = 8;
	const values = equity.map((p) => p.equity);
	const points = seriesPath(values, width, height, pad);

	return (
		`<svg class="chart" viewBox="0 0 ${width} ${height}" ` +
		`preserveAspectRatio="none" role="img" aria-label="Equity curve">` +
		`<polyline fill="none" stroke="#2563eb" stroke-width="1.5" points="${points}" />` +
		`</svg>`
	);
}

/** Same renderer as `equitySvg`, applied to drawdown values (<= 0). */
function drawdownSvg(drawdown: DrawdownPoint[], width = 720, height = 160): string {
	if (drawdown.length === 0) {
		return '<p class="empty">No drawdown data.</p>';
	}

	const pad = 8;
	const values = drawdown.map((p) => p.drawdown);
	const points = seriesPath(values, width, height, pad);

	return (
		`<svg class="chart" viewBox="0 0 ${width} ${height}" ` +
		`preserveAspectRatio="none" role="img" aria-label="Drawdown">` +
		`<polyline fill="none" stroke="#dc2626" stroke-width="1.5" points="${points}" />` +
		`</svg>`
	);
}

const MONTH_LABELS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
] as const;

/** Monthly returns laid out as a year-by-month grid of signed percentages. */
function monthlyReturnsHtml(monthly: MonthlyReturn[]): string {
	if (monthly.length === 0) {
		return '<p class="empty">No monthly returns.</p>';
	}

	const byYear = new Map<number, Map<number, number>>();
	for (const m of monthly) {
		const row = byYear.get(m.year) ?? new Map<number, number>();
		row.set(m.month, m.returnPct);
		byYear.set(m.year, row);
	}

	const years = [...byYear.keys()].sort((a, b) => a - b);
	const head =
		'<tr><th scope="col">Year</th>' +
		MONTH_LABELS.map((label) => `<th scope="col">${label}</th>`).join('') +
		'</tr>';

	const rows = years.map((year) => {
		const row = byYear.get(year) ?? new Map<number, number>();
		const cells = MONTH_LABELS.map((_, idx) => {
			const value = row.get(idx + 1);
			if (value === undefined) return '<td class="month empty-cell">—</td>';
			const cls = value > 0 ? 'pos' : value < 0 ? 'neg' : 'flat';
			return `<td class="month ${cls}">${escapeHtml(formatSignedPercent(value))}</td>`;
		}).join('');
		return `<tr><th scope="row">${escapeHtml(String(year))}</th>${cells}</tr>`;
	});

	return `<table class="monthly"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table>`;
}

interface TradeSummary {
	count: number;
	wins: number;
	losses: number;
	winRate: number;
	grossProfit: number;
	grossLoss: number;
	netPnl: number;
}

/** Derive a trade summary (count, win rate, gross/net) straight from the trades. */
function summarizeTrades(trades: Trade[]): TradeSummary {
	let wins = 0;
	let losses = 0;
	let grossProfit = 0;
	let grossLoss = 0;
	let netPnl = 0;

	for (const t of trades) {
		netPnl += t.pnl;
		if (t.pnl > 0) {
			wins += 1;
			grossProfit += t.pnl;
		} else if (t.pnl < 0) {
			losses += 1;
			grossLoss += t.pnl;
		}
	}

	const count = trades.length;
	return {
		count,
		wins,
		losses,
		winRate: count > 0 ? wins / count : NaN,
		grossProfit,
		grossLoss,
		netPnl
	};
}

function tradeSummaryHtml(trades: Trade[]): string {
	const s = summarizeTrades(trades);
	const rows: Array<[string, string]> = [
		['Trades', String(s.count)],
		['Wins', String(s.wins)],
		['Losses', String(s.losses)],
		['Win rate', formatPercent(s.winRate)],
		['Gross profit', formatSignedCurrency(s.grossProfit)],
		['Gross loss', formatSignedCurrency(s.grossLoss)],
		['Net P&L', formatSignedCurrency(s.netPnl)]
	];

	const cells = rows
		.map(
			([label, value]) =>
				`<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
		)
		.join('');

	return `<table class="summary"><tbody>${cells}</tbody></table>`;
}

/** Human-readable description of a commission model for the audit block. */
function describeCommission(c: BacktestResult['spec']['risk']['commission']): string {
	switch (c.mode) {
		case 'none':
			return 'None';
		case 'perShare':
			return `Per share (${formatCurrency(c.perShare)})`;
		case 'perTrade':
			return `Per trade (${formatCurrency(c.perTrade)})`;
		case 'percent':
			return `Percent (${formatPercent(c.percent)})`;
	}
}

/** Human-readable description of a slippage model for the audit block. */
function describeSlippage(s: BacktestResult['spec']['risk']['slippage']): string {
	switch (s.mode) {
		case 'none':
			return 'None';
		case 'percent':
			return `Percent (${formatPercent(s.percent)})`;
		case 'ticks':
			return `Ticks (${s.ticks} × ${s.tickSize})`;
	}
}

function auditHtml(result: BacktestResult): string {
	const { spec } = result;
	const rows: Array<[string, string]> = [
		['Fill model', spec.execution.fillOn],
		['Order type', spec.execution.orderType],
		['Commission', describeCommission(spec.risk.commission)],
		['Slippage', describeSlippage(spec.risk.slippage)],
		['Initial capital', formatCurrency(spec.risk.initialCapital)],
		['Run id', result.runId],
		['Computed at', formatDateTime(result.computedAt)]
	];

	const cells = rows
		.map(
			([label, value]) =>
				`<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
		)
		.join('');

	return `<table class="audit"><tbody>${cells}</tbody></table>`;
}

function warningsHtml(warnings: string[]): string {
	if (warnings.length === 0) {
		return '<p class="empty">No warnings.</p>';
	}
	const items = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
	return `<ul class="warnings">${items}</ul>`;
}

function headerHtml(result: BacktestResult): string {
	const { spec } = result;
	const tickers = spec.universe.tickers.join(', ') || '—';
	const { from, to } = spec.universe.dateRange;
	const meta: Array<[string, string]> = [
		['Tickers', tickers],
		['Timeframe', spec.universe.timeframe],
		['Date range', `${from} → ${to}`],
		['Run time', formatDateTime(result.computedAt)]
	];

	const dl = meta
		.map(
			([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
		)
		.join('');

	return (
		`<header class="tearsheet-header">` +
		`<h1>${escapeHtml(spec.name)}</h1>` +
		`<dl class="meta">${dl}</dl>` +
		`</header>`
	);
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
	margin: 0;
	padding: 24px;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
	color: #111827;
	background: #ffffff;
	line-height: 1.45;
}
.tearsheet-header h1 { margin: 0 0 8px; font-size: 24px; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 24px; margin: 0; }
.meta div { display: flex; gap: 6px; }
.meta dt { font-weight: 600; color: #374151; }
.meta dd { margin: 0; }
section { margin-top: 28px; }
section > h2 { margin: 0 0 12px; font-size: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #f3f4f6; }
td { text-align: right; font-variant-numeric: tabular-nums; }
.metrics .group-row th { background: #f9fafb; font-weight: 700; text-align: left; }
.monthly th, .monthly td { text-align: center; }
.monthly td.pos { color: #047857; }
.monthly td.neg { color: #b91c1c; }
.monthly td.empty-cell { color: #9ca3af; }
.summary, .audit { max-width: 420px; }
.chart { width: 100%; height: auto; background: #fafafa; border: 1px solid #e5e7eb; }
.warnings { margin: 0; padding-left: 20px; color: #92400e; }
.empty { color: #6b7280; font-style: italic; margin: 0; }
.validation { font-size: 13px; }
footer { margin-top: 32px; font-size: 11px; color: #9ca3af; }
`;

function section(title: string, body: string): string {
	return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

/**
 * Build a complete, self-contained HTML tearsheet for a backtest run. All
 * user-supplied strings are HTML-escaped. When `opts.validationHtml` is given it
 * is embedded verbatim in a Validation section (the caller is responsible for
 * that fragment's safety).
 */
export function buildTearsheetHtml(
	result: BacktestResult,
	opts: { validationHtml?: string } = {}
): string {
	const title = `Tearsheet — ${result.spec.name}`;

	const sections = [
		section('Key metrics', metricsTableHtml(result.metrics)),
		section('Equity curve', equitySvg(result.equityCurve)),
		section('Drawdown', drawdownSvg(result.drawdown)),
		section('Monthly returns', monthlyReturnsHtml(result.monthlyReturns)),
		section('Trade summary', tradeSummaryHtml(result.trades)),
		section('Warnings', warningsHtml(result.warnings)),
		section('Audit', auditHtml(result))
	];

	if (opts.validationHtml !== undefined) {
		sections.push(
			`<section><h2>Validation</h2><div class="validation">${opts.validationHtml}</div></section>`
		);
	}

	return (
		`<!doctype html>\n` +
		`<html lang="en">\n` +
		`<head>\n` +
		`<meta charset="utf-8" />\n` +
		`<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
		`<title>${escapeHtml(title)}</title>\n` +
		`<style>${STYLE}</style>\n` +
		`</head>\n` +
		`<body>\n` +
		headerHtml(result) +
		sections.join('') +
		`<footer>Generated from run ${escapeHtml(result.runId)} · computed ${escapeHtml(
			formatDate(result.computedAt)
		)}</footer>\n` +
		`</body>\n` +
		`</html>\n`
	);
}

/** Build the tearsheet HTML and trigger a browser download. */
export function exportTearsheet(result: BacktestResult, filename: string): void {
	const html = buildTearsheetHtml(result);
	const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
	downloadBlob(blob, filename);
}
