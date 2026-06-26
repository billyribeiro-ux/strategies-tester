import { describe, it, expect } from 'vitest';
import { splitDateRange, MAX_RANGE_YEARS } from './range';

const ms = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const DAY = 86_400_000;

describe('splitDateRange', () => {
	it('returns a single window for ranges within the limit', () => {
		expect(splitDateRange('2022-01-01', '2024-01-01', MAX_RANGE_YEARS)).toEqual([
			{ from: '2022-01-01', to: '2024-01-01' }
		]);
	});

	it('chunks a >5y range into adjacent, non-overlapping windows that cover it', () => {
		const w = splitDateRange('2010-01-01', '2024-01-01', 5);
		expect(w.length).toBe(3);
		expect(w[0].from).toBe('2010-01-01');
		expect(w[w.length - 1].to).toBe('2024-01-01');
		for (let i = 1; i < w.length; i++) {
			// next window starts exactly one day after the previous ends (no gap, no overlap)
			expect(ms(w[i].from) - ms(w[i - 1].to)).toBe(DAY);
		}
		for (const win of w) {
			expect(ms(win.to) - ms(win.from)).toBeLessThanOrEqual(5 * 366 * DAY);
		}
	});

	it('covers a long span with no gaps and an exact end', () => {
		const w = splitDateRange('2000-06-15', '2026-06-15', 5);
		expect(w[0].from).toBe('2000-06-15');
		expect(w[w.length - 1].to).toBe('2026-06-15');
		for (let i = 1; i < w.length; i++) {
			expect(ms(w[i].from) - ms(w[i - 1].to)).toBe(DAY);
		}
	});

	it('returns one window for invalid or reversed ranges', () => {
		expect(splitDateRange('bad', '2024-01-01')).toEqual([{ from: 'bad', to: '2024-01-01' }]);
		expect(splitDateRange('2024-01-01', '2020-01-01')).toEqual([
			{ from: '2024-01-01', to: '2020-01-01' }
		]);
	});
});
