/**
 * Excel (.xlsx) export built with ExcelJS. Three sheets:
 *   • "Trades"       — the full ledger with currency/date number formats,
 *                      frozen header, sized columns, and win/loss row fills.
 *   • "Summary"      — headline metrics + aggregated totals as label/value rows.
 *   • "Equity Curve" — timestamped equity + drawdown series.
 *
 * All numbers come straight from the BacktestResult; the totals are presentational
 * aggregation of the given trades (no simulation).
 */

import { Workbook, type Worksheet, type Fill } from 'exceljs';
import type { BacktestResult, MetricValue, Trade } from '$lib/types';
import { EXIT_REASON_LABELS } from '$lib/types';
import { computeTotals, type LedgerTotals } from './ledger';
import { downloadBlob } from './download';

const CURRENCY_FMT = '$#,##0.00';
const DATETIME_FMT = 'yyyy-mm-dd hh:mm';
const PCT_FMT = '0.00%';
const RATIO_FMT = '0.00';
const INT_FMT = '#,##0';

const WIN_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } };
const LOSS_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8E6' } };
const HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F4' } };

/** Parse an ISO timestamp into a Date, or null if unparseable. */
function toDate(iso: string): Date | null {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

interface ColSpec {
	header: string;
	width: number;
	/** Produce the typed cell value for a trade. */
	value: (t: Trade, i: number) => string | number | Date | null;
	numFmt?: string;
}

const TRADE_COLS: ColSpec[] = [
	{ header: '#', width: 6, value: (_t, i) => i + 1, numFmt: INT_FMT },
	{ header: 'Side', width: 8, value: (t) => (t.side === 'long' ? 'Long' : 'Short') },
	{ header: 'Ticker', width: 10, value: (t) => t.ticker },
	{ header: 'Entry', width: 19, value: (t) => toDate(t.entryTime), numFmt: DATETIME_FMT },
	{ header: 'Entry price', width: 13, value: (t) => t.entryPrice, numFmt: CURRENCY_FMT },
	{ header: 'Exit', width: 19, value: (t) => toDate(t.exitTime), numFmt: DATETIME_FMT },
	{ header: 'Exit price', width: 13, value: (t) => t.exitPrice, numFmt: CURRENCY_FMT },
	{ header: 'Qty', width: 9, value: (t) => t.qty, numFmt: INT_FMT },
	{ header: 'Exit reason', width: 15, value: (t) => EXIT_REASON_LABELS[t.exitReason] },
	{
		header: 'Stop price',
		width: 13,
		value: (t) => t.stopPrice,
		numFmt: CURRENCY_FMT
	},
	{
		header: 'Target price',
		width: 13,
		value: (t) => t.targetPrice,
		numFmt: CURRENCY_FMT
	},
	{ header: 'P&L $', width: 14, value: (t) => t.pnl, numFmt: CURRENCY_FMT },
	{ header: 'P&L %', width: 10, value: (t) => t.pnlPct, numFmt: PCT_FMT },
	{
		header: 'R-multiple',
		width: 11,
		value: (t) => (Number.isFinite(t.rMultiple) ? t.rMultiple : null),
		numFmt: RATIO_FMT
	},
	{ header: 'Bars held', width: 10, value: (t) => t.barsHeld, numFmt: INT_FMT },
	{ header: 'MAE', width: 10, value: (t) => t.mae, numFmt: PCT_FMT },
	{ header: 'MFE', width: 10, value: (t) => t.mfe, numFmt: PCT_FMT },
	{ header: 'Cumulative P&L $', width: 16, value: (t) => t.cumulativePnl, numFmt: CURRENCY_FMT }
];

function styleHeaderRow(ws: Worksheet, rowNumber: number, columns: number): void {
	const row = ws.getRow(rowNumber);
	row.font = { bold: true };
	row.fill = HEADER_FILL;
	for (let c = 1; c <= columns; c++) {
		row.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FFBDC1C6' } } };
	}
}

function buildTradesSheet(wb: Workbook, trades: Trade[]): void {
	const ws = wb.addWorksheet('Trades');
	ws.columns = TRADE_COLS.map((c) => ({ header: c.header, width: c.width }));
	ws.views = [{ state: 'frozen', ySplit: 1 }];
	styleHeaderRow(ws, 1, TRADE_COLS.length);

	trades.forEach((trade, i) => {
		const values = TRADE_COLS.map((c) => c.value(trade, i));
		const row = ws.addRow(values);
		TRADE_COLS.forEach((c, ci) => {
			if (c.numFmt) row.getCell(ci + 1).numFmt = c.numFmt;
		});
		if (trade.pnl > 0) row.fill = WIN_FILL;
		else if (trade.pnl < 0) row.fill = LOSS_FILL;
	});

	ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TRADE_COLS.length } };
}

interface SummaryRow {
	label: string;
	value: number | string;
	numFmt?: string;
}

function metricNumFmt(metric: MetricValue): string | undefined {
	switch (metric.format) {
		case 'currency':
			return CURRENCY_FMT;
		case 'pct':
			return PCT_FMT;
		case 'ratio':
			return RATIO_FMT;
		case 'r':
			return RATIO_FMT;
		case 'int':
		case 'duration':
			return INT_FMT;
	}
}

function finite(n: number): number | string {
	return Number.isFinite(n) ? n : '—';
}

function buildSummarySheet(wb: Workbook, result: BacktestResult, totals: LedgerTotals): void {
	const ws = wb.addWorksheet('Summary');
	ws.columns = [
		{ header: 'Metric', width: 30 },
		{ header: 'Value', width: 18 }
	];
	ws.views = [{ state: 'frozen', ySplit: 1 }];
	styleHeaderRow(ws, 1, 2);

	const section = (label: string): SummaryRow => ({ label, value: '' });

	const rows: SummaryRow[] = [
		section('Headline metrics'),
		...result.metrics.map((m) => ({
			label: m.label,
			value: finite(m.value),
			numFmt: metricNumFmt(m)
		})),
		section(''),
		section('Trade totals'),
		{ label: 'Total trades', value: totals.totalTrades, numFmt: INT_FMT },
		{ label: 'Wins', value: totals.wins, numFmt: INT_FMT },
		{ label: 'Losses', value: totals.losses, numFmt: INT_FMT },
		{ label: 'Win rate', value: finite(totals.winRate), numFmt: PCT_FMT },
		{ label: 'Gross win $', value: finite(totals.grossWin), numFmt: CURRENCY_FMT },
		{ label: 'Gross loss $', value: finite(totals.grossLoss), numFmt: CURRENCY_FMT },
		{ label: 'Net $', value: finite(totals.net), numFmt: CURRENCY_FMT },
		{ label: 'Profit factor', value: finite(totals.profitFactor), numFmt: RATIO_FMT },
		{ label: 'Avg win $', value: finite(totals.avgWin), numFmt: CURRENCY_FMT },
		{ label: 'Avg loss $', value: finite(totals.avgLoss), numFmt: CURRENCY_FMT },
		{ label: 'Largest win $', value: finite(totals.largestWin), numFmt: CURRENCY_FMT },
		{ label: 'Largest loss $', value: finite(totals.largestLoss), numFmt: CURRENCY_FMT },
		{ label: 'Avg R', value: finite(totals.avgR), numFmt: RATIO_FMT },
		{ label: 'Expectancy $', value: finite(totals.expectancy), numFmt: CURRENCY_FMT },
		{ label: 'Avg bars held', value: finite(totals.avgBarsHeld), numFmt: RATIO_FMT },
		{ label: 'Total bars', value: totals.totalBars, numFmt: INT_FMT }
	];

	for (const r of rows) {
		const row = ws.addRow([r.label, r.value]);
		if (r.value === '') {
			// Section heading row.
			row.getCell(1).font = { bold: true };
		} else if (r.numFmt) {
			row.getCell(2).numFmt = r.numFmt;
		}
	}
}

function buildEquitySheet(wb: Workbook, result: BacktestResult): void {
	const ws = wb.addWorksheet('Equity Curve');
	ws.columns = [
		{ header: 'Timestamp', width: 22 },
		{ header: 'Equity', width: 16 },
		{ header: 'Drawdown', width: 12 }
	];
	ws.views = [{ state: 'frozen', ySplit: 1 }];
	styleHeaderRow(ws, 1, 3);

	// Align drawdown to equity timestamps when present.
	const drawdownByT = new Map(result.drawdown.map((d) => [d.t, d.drawdown]));

	for (const point of result.equityCurve) {
		const dd = drawdownByT.get(point.t);
		const row = ws.addRow([toDate(point.t), point.equity, dd ?? null]);
		row.getCell(1).numFmt = DATETIME_FMT;
		row.getCell(2).numFmt = CURRENCY_FMT;
		row.getCell(3).numFmt = PCT_FMT;
	}

	// If drawdown has timestamps not covered by the equity curve, append them.
	const equityTs = new Set(result.equityCurve.map((p) => p.t));
	for (const d of result.drawdown) {
		if (!equityTs.has(d.t)) {
			const row = ws.addRow([toDate(d.t), null, d.drawdown]);
			row.getCell(1).numFmt = DATETIME_FMT;
			row.getCell(3).numFmt = PCT_FMT;
		}
	}
}

/** Build the workbook as a transferable ArrayBuffer. */
export async function buildWorkbook(result: BacktestResult): Promise<ArrayBuffer> {
	const wb = new Workbook();
	wb.creator = 'Strategies Tester';
	wb.created = new Date();

	const totals = computeTotals(result.trades);
	buildTradesSheet(wb, result.trades);
	buildSummarySheet(wb, result, totals);
	buildEquitySheet(wb, result);

	const buffer = await wb.xlsx.writeBuffer();
	// ExcelJS returns a Node Buffer (browser shim: ArrayBuffer-like). Normalize
	// to a standalone ArrayBuffer slice so callers get a clean transferable.
	const view = buffer as unknown as Uint8Array;
	return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** Build the workbook and trigger a browser download. */
export async function exportXlsx(result: BacktestResult, filename: string): Promise<void> {
	const buffer = await buildWorkbook(result);
	const blob = new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	downloadBlob(blob, filename);
}
