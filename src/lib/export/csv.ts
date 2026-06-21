/**
 * RFC-4180 CSV serialization of the trade ledger.
 *
 * - CRLF (\r\n) line terminators.
 * - A field is quoted iff it contains a comma, double-quote, CR, or LF.
 * - Embedded double-quotes are escaped by doubling them.
 * - Timestamps are emitted as the backend's ISO-8601 strings (raw entry/exit
 *   columns), numbers as their plain decimal form — no locale formatting.
 */

import type { Trade } from '$lib/types';
import { LEDGER_COLUMNS } from './ledger';

/** Quote a single field per RFC-4180 when (and only when) required. */
export function csvField(raw: string): string {
	if (/[",\r\n]/.test(raw)) {
		return `"${raw.replace(/"/g, '""')}"`;
	}
	return raw;
}

function csvRow(fields: string[]): string {
	return fields.map(csvField).join(',');
}

export function tradesToCsv(trades: Trade[]): string {
	const header = LEDGER_COLUMNS.map((c) => c.label);
	const lines: string[] = [csvRow(header)];

	trades.forEach((trade, i) => {
		lines.push(csvRow(LEDGER_COLUMNS.map((c) => c.csv(trade, i))));
	});

	// RFC-4180: records separated by CRLF; a trailing CRLF is permitted and
	// produces a clean final newline.
	return lines.join('\r\n') + '\r\n';
}
