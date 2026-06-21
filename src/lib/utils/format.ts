/**
 * Presentation formatters shared by the results and management UIs.
 * These format already-computed values; they never perform simulation math.
 */

import type { MetricFormat } from '$lib/types';

const usd = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 2
});

export function formatCurrency(value: number): string {
	if (!Number.isFinite(value)) return '—';
	return usd.format(value);
}

export function formatSignedCurrency(value: number): string {
	if (!Number.isFinite(value)) return '—';
	const s = usd.format(Math.abs(value));
	return value < 0 ? `−${s}` : value > 0 ? `+${s}` : s;
}

export function formatPercent(fraction: number, digits = 2): string {
	if (!Number.isFinite(fraction)) return '—';
	return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatSignedPercent(fraction: number, digits = 2): string {
	if (!Number.isFinite(fraction)) return '—';
	const sign = fraction > 0 ? '+' : fraction < 0 ? '−' : '';
	return `${sign}${(Math.abs(fraction) * 100).toFixed(digits)}%`;
}

export function formatRatio(value: number, digits = 2): string {
	if (!Number.isFinite(value)) return '—';
	return value.toFixed(digits);
}

export function formatRMultiple(value: number, digits = 2): string {
	if (!Number.isFinite(value)) return '—';
	return `${value.toFixed(digits)}R`;
}

export function formatInt(value: number): string {
	if (!Number.isFinite(value)) return '—';
	return Math.round(value).toLocaleString('en-US');
}

export function formatNumber(value: number, digits = 2): string {
	if (!Number.isFinite(value)) return '—';
	return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatDuration(bars: number): string {
	if (!Number.isFinite(bars)) return '—';
	return `${Math.round(bars)} bars`;
}

/** Render a metric according to its declared format. */
export function formatMetric(value: number, format: MetricFormat): string {
	switch (format) {
		case 'pct':
			return formatPercent(value);
		case 'ratio':
			return formatRatio(value);
		case 'currency':
			return formatCurrency(value);
		case 'int':
			return formatInt(value);
		case 'duration':
			return formatDuration(value);
		case 'r':
			return formatRMultiple(value);
	}
}

// --- date/time (ISO in, split parts out for the ledger) ----------------------

export function formatDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toISOString().slice(0, 10); // yyyy-mm-dd
}

export function formatTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toISOString().slice(11, 19); // HH:mm:ss
}

export function formatDateTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return `${formatDate(iso)} ${formatTime(iso)}`;
}
