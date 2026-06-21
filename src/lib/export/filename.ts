/**
 * Deterministic export filenames derived from the strategy spec.
 *
 * Pattern: `{strategyName}_{ticker}_{from}_{to}.{ext}` where `ticker` is the
 * single universe ticker, or `portfolio` when the run spans multiple tickers.
 * All segments are sanitized to the safe set `[A-Za-z0-9._-]` so the result is
 * a valid filename on every platform.
 */

import type { StrategySpec } from '$lib/types';

/** Replace any run of unsafe characters with a single underscore. */
function sanitize(segment: string): string {
	const cleaned = segment.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
	return cleaned.length > 0 ? cleaned : 'untitled';
}

export function buildFilename(spec: StrategySpec, ext: string): string {
	const tickers = spec.universe.tickers;
	const ticker = tickers.length === 1 ? tickers[0] : 'portfolio';
	const { from, to } = spec.universe.dateRange;

	const stem = [spec.name, ticker, from, to].map(sanitize).join('_');
	const safeExt = sanitize(ext);
	return `${stem}.${safeExt}`;
}
