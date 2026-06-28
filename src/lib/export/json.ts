/**
 * Full-result JSON export — the complete `BacktestResult` (spec + metrics +
 * equity curve + drawdown + trades + monthly returns + distribution + any
 * benchmark/candles) serialized losslessly. Unlike the CSV (trades only) and
 * the Excel workbook (summarized sheets), this captures the entire run so it can
 * be archived or re-loaded elsewhere. Trades passed in are the caller's already
 * filtered + sorted view, so the JSON mirrors what the user sees.
 */

import type { BacktestResult, Trade } from '$lib/types';
import { downloadBlob } from './download';

/** Pretty-print a result to a JSON string, substituting the visible trades. */
export function resultToJson(result: BacktestResult, trades: Trade[]): string {
	const payload: BacktestResult = { ...result, trades };
	return JSON.stringify(payload, null, 2);
}

/** Serialize the full result to JSON and trigger a browser download. */
export function exportResultJson(result: BacktestResult, trades: Trade[], filename: string): void {
	const blob = new Blob([resultToJson(result, trades)], {
		type: 'application/json;charset=utf-8'
	});
	downloadBlob(blob, filename);
}
