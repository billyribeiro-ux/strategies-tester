/**
 * Shared chart theming + scale helpers. Colors resolve to the app's CSS design
 * tokens so every chart follows the active light/dark theme automatically.
 *
 * These are presentational helpers only — no P&L or indicator math.
 */

import { scaleLinear } from 'd3-scale';

/** Token-backed colors used across charts. Reference tokens, never hex. */
export const chartColors = {
	long: 'var(--c-long)',
	longSoft: 'var(--c-long-soft)',
	short: 'var(--c-short)',
	shortSoft: 'var(--c-short-soft)',
	primary: 'var(--c-primary)',
	primarySoft: 'var(--c-primary-soft)',
	grid: 'var(--c-border)',
	gridStrong: 'var(--c-border-strong)',
	axis: 'var(--c-text-faint)',
	axisLabel: 'var(--c-text-muted)',
	surface: 'var(--c-surface)',
	text: 'var(--c-text)',
	textMuted: 'var(--c-text-muted)'
} as const;

/** Color a value by sign: gains green, losses red, neutral muted. */
export function colorForSign(value: number): string {
	if (value > 0) return chartColors.long;
	if (value < 0) return chartColors.short;
	return chartColors.textMuted;
}

/** Soft (fill) color by sign. */
export function softColorForSign(value: number): string {
	if (value > 0) return chartColors.longSoft;
	if (value < 0) return chartColors.shortSoft;
	return chartColors.surface;
}

/** Standard inner padding for the plot area inside a responsive SVG. */
export interface Margins {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export const defaultMargins: Margins = { top: 12, right: 16, bottom: 28, left: 56 };

/**
 * "Nice", human-friendly axis ticks for a numeric domain. Wraps d3's linear
 * scale tick generation so all charts share the same tick density behaviour.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
	if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
	if (min === max) return [min];
	return scaleLinear().domain([min, max]).nice(count).ticks(count);
}

/**
 * Diverging green↔red interpolation for the monthly heatmap. `t` is a signed
 * intensity in [-1, 1]; negative → red, positive → green, 0 → neutral surface.
 * Uses color-mix so it tracks the theme tokens.
 */
export function divergingFill(t: number): string {
	const clamped = Math.max(-1, Math.min(1, t));
	if (clamped === 0) return 'var(--c-surface-2)';
	const pct = Math.round(Math.abs(clamped) * 70 + 12); // 12%..82%
	const base = clamped > 0 ? 'var(--c-long)' : 'var(--c-short)';
	return `color-mix(in oklch, ${base} ${pct}%, var(--c-surface))`;
}

/**
 * Even subsampling of a series down to at most `max` points, always keeping the
 * first and last. Used to keep candlestick rendering performant on long ranges.
 */
export function downsample<T>(items: readonly T[], max: number): T[] {
	if (items.length <= max) return items.slice();
	const step = (items.length - 1) / (max - 1);
	const out: T[] = [];
	for (let i = 0; i < max; i++) {
		out.push(items[Math.round(i * step)]);
	}
	return out;
}
