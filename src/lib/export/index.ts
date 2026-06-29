/**
 * Public surface of the client-side export module. All exports respect whatever
 * (already filtered/sorted) trades the caller passes in.
 */

import type { Trade } from '$lib/types';
import { tradesToCsv } from './csv';
import { downloadBlob } from './download';

export { buildFilename } from './filename';
export { downloadBlob } from './download';
export { tradesToCsv, csvField } from './csv';
export { buildWorkbook, exportXlsx } from './xlsx';
export { resultToJson, exportResultJson } from './json';
export {
	escapeHtml,
	metricsTableHtml,
	equitySvg,
	buildTearsheetHtml,
	exportTearsheet
} from './tearsheet';
export { printHtml, printTearsheet } from './print';
export { computeTotals, LEDGER_COLUMNS } from './ledger';
export type { LedgerColumn, LedgerTotals, ColumnType } from './ledger';

/** Serialize trades to CSV and trigger a browser download. */
export function exportCsv(trades: Trade[], filename: string): void {
	const csv = tradesToCsv(trades);
	// BOM so Excel opens UTF-8 CSV with correct encoding.
	const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
	downloadBlob(blob, filename);
}
