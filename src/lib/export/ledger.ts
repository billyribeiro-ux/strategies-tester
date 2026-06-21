/**
 * The canonical trade-ledger column model — the single source of truth shared
 * by the on-screen TradeTable, the CSV export, and the XLSX export. Defining
 * the columns once guarantees every surface stays in lock-step.
 *
 * NOTE: nothing here simulates P&L. We only read fields the backend already
 * computed and (for the totals row) aggregate them with sums/averages, which is
 * presentational summarization of given trades.
 */

import type { Trade } from '$lib/types';
import { EXIT_REASON_LABELS } from '$lib/types';
import {
	formatCurrency,
	formatDate,
	formatInt,
	formatPercent,
	formatRMultiple,
	formatSignedCurrency,
	formatSignedPercent,
	formatTime
} from '$lib/utils/format';

/** How a column's value participates in sorting/filtering. */
export type ColumnType = 'index' | 'text' | 'enum' | 'number' | 'currency' | 'percent' | 'r';

export interface LedgerColumn {
	/** Stable key, also used as the sort key. */
	key: string;
	/** Header label (also the CSV/XLSX header). */
	label: string;
	type: ColumnType;
	/** Numeric/text value used for sorting & range/text filtering. */
	value: (trade: Trade, index: number) => number | string;
	/** Human-readable cell text for the table. */
	display: (trade: Trade, index: number) => string;
	/** Raw value for CSV (ISO timestamps, raw numbers). */
	csv: (trade: Trade, index: number) => string;
	/** Distinct enum options (only for type === 'enum'). */
	enumOptions?: (trades: Trade[]) => { value: string; label: string }[];
}

const num = (n: number) => (Number.isFinite(n) ? String(n) : '');

export const LEDGER_COLUMNS: LedgerColumn[] = [
	{
		key: 'index',
		label: '#',
		type: 'index',
		value: (_t, i) => i + 1,
		display: (_t, i) => String(i + 1),
		csv: (_t, i) => String(i + 1)
	},
	{
		key: 'side',
		label: 'Side',
		type: 'enum',
		value: (t) => t.side,
		display: (t) => (t.side === 'long' ? 'Long' : 'Short'),
		csv: (t) => t.side,
		enumOptions: () => [
			{ value: 'long', label: 'Long' },
			{ value: 'short', label: 'Short' }
		]
	},
	{
		key: 'ticker',
		label: 'Ticker',
		type: 'text',
		value: (t) => t.ticker,
		display: (t) => t.ticker,
		csv: (t) => t.ticker
	},
	{
		key: 'entryDate',
		label: 'Entry date',
		type: 'text',
		value: (t) => t.entryTime,
		display: (t) => formatDate(t.entryTime),
		csv: (t) => t.entryTime
	},
	{
		key: 'entryTime',
		label: 'Entry time',
		type: 'text',
		value: (t) => t.entryTime,
		display: (t) => formatTime(t.entryTime),
		csv: (t) => t.entryTime
	},
	{
		key: 'entryPrice',
		label: 'Entry price',
		type: 'currency',
		value: (t) => t.entryPrice,
		display: (t) => formatCurrency(t.entryPrice),
		csv: (t) => num(t.entryPrice)
	},
	{
		key: 'exitDate',
		label: 'Exit date',
		type: 'text',
		value: (t) => t.exitTime,
		display: (t) => formatDate(t.exitTime),
		csv: (t) => t.exitTime
	},
	{
		key: 'exitTime',
		label: 'Exit time',
		type: 'text',
		value: (t) => t.exitTime,
		display: (t) => formatTime(t.exitTime),
		csv: (t) => t.exitTime
	},
	{
		key: 'exitPrice',
		label: 'Exit price',
		type: 'currency',
		value: (t) => t.exitPrice,
		display: (t) => formatCurrency(t.exitPrice),
		csv: (t) => num(t.exitPrice)
	},
	{
		key: 'qty',
		label: 'Qty',
		type: 'number',
		value: (t) => t.qty,
		display: (t) => formatInt(t.qty),
		csv: (t) => num(t.qty)
	},
	{
		key: 'exitReason',
		label: 'Exit reason',
		type: 'enum',
		value: (t) => t.exitReason,
		display: (t) => EXIT_REASON_LABELS[t.exitReason],
		csv: (t) => EXIT_REASON_LABELS[t.exitReason],
		enumOptions: () =>
			Object.entries(EXIT_REASON_LABELS).map(([value, label]) => ({ value, label }))
	},
	{
		key: 'stopPrice',
		label: 'Stop price',
		type: 'currency',
		value: (t) => (t.stopPrice ?? Number.NaN),
		display: (t) => (t.stopPrice === null ? '—' : formatCurrency(t.stopPrice)),
		csv: (t) => (t.stopPrice === null ? '' : num(t.stopPrice))
	},
	{
		key: 'targetPrice',
		label: 'Target price',
		type: 'currency',
		value: (t) => (t.targetPrice ?? Number.NaN),
		display: (t) => (t.targetPrice === null ? '—' : formatCurrency(t.targetPrice)),
		csv: (t) => (t.targetPrice === null ? '' : num(t.targetPrice))
	},
	{
		key: 'pnl',
		label: 'P&L $',
		type: 'currency',
		value: (t) => t.pnl,
		display: (t) => formatSignedCurrency(t.pnl),
		csv: (t) => num(t.pnl)
	},
	{
		key: 'pnlPct',
		label: 'P&L %',
		type: 'percent',
		value: (t) => t.pnlPct,
		display: (t) => formatSignedPercent(t.pnlPct),
		csv: (t) => num(t.pnlPct)
	},
	{
		key: 'rMultiple',
		label: 'R-multiple',
		type: 'r',
		value: (t) => t.rMultiple,
		display: (t) => formatRMultiple(t.rMultiple),
		csv: (t) => num(t.rMultiple)
	},
	{
		key: 'barsHeld',
		label: 'Bars held',
		type: 'number',
		value: (t) => t.barsHeld,
		display: (t) => formatInt(t.barsHeld),
		csv: (t) => num(t.barsHeld)
	},
	{
		key: 'mae',
		label: 'MAE',
		type: 'percent',
		value: (t) => t.mae,
		display: (t) => formatPercent(t.mae),
		csv: (t) => num(t.mae)
	},
	{
		key: 'mfe',
		label: 'MFE',
		type: 'percent',
		value: (t) => t.mfe,
		display: (t) => formatPercent(t.mfe),
		csv: (t) => num(t.mfe)
	},
	{
		key: 'cumulativePnl',
		label: 'Cumulative P&L $',
		type: 'currency',
		value: (t) => t.cumulativePnl,
		display: (t) => formatSignedCurrency(t.cumulativePnl),
		csv: (t) => num(t.cumulativePnl)
	}
];

/** Aggregated totals over a set of (filtered) trades — summarization only. */
export interface LedgerTotals {
	totalTrades: number;
	wins: number;
	losses: number;
	winRate: number; // fraction
	grossWin: number;
	grossLoss: number; // <= 0
	net: number;
	profitFactor: number;
	avgWin: number;
	avgLoss: number; // <= 0
	largestWin: number;
	largestLoss: number; // <= 0
	avgR: number;
	expectancy: number; // avg P&L per trade
	avgBarsHeld: number;
	totalBars: number;
}

export function computeTotals(trades: Trade[]): LedgerTotals {
	const n = trades.length;
	const winners = trades.filter((t) => t.pnl > 0);
	const losers = trades.filter((t) => t.pnl < 0);

	const grossWin = winners.reduce((s, t) => s + t.pnl, 0);
	const grossLoss = losers.reduce((s, t) => s + t.pnl, 0); // negative
	const net = trades.reduce((s, t) => s + t.pnl, 0);

	const largestWin = winners.reduce((m, t) => Math.max(m, t.pnl), 0);
	const largestLoss = losers.reduce((m, t) => Math.min(m, t.pnl), 0);

	const rValues = trades.map((t) => t.rMultiple).filter((r) => Number.isFinite(r));
	const avgR = rValues.length ? rValues.reduce((s, r) => s + r, 0) / rValues.length : Number.NaN;

	const totalBars = trades.reduce((s, t) => s + t.barsHeld, 0);

	return {
		totalTrades: n,
		wins: winners.length,
		losses: losers.length,
		winRate: n ? winners.length / n : Number.NaN,
		grossWin,
		grossLoss,
		net,
		profitFactor: grossLoss !== 0 ? grossWin / Math.abs(grossLoss) : Number.NaN,
		avgWin: winners.length ? grossWin / winners.length : Number.NaN,
		avgLoss: losers.length ? grossLoss / losers.length : Number.NaN,
		largestWin,
		largestLoss,
		avgR,
		expectancy: n ? net / n : Number.NaN,
		avgBarsHeld: n ? totalBars / n : Number.NaN,
		totalBars
	};
}
