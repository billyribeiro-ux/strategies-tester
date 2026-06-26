/** FMP request-window math — pure (no env/DB) so it is unit-testable. */

/** FMP's documented maximum span per historical request. */
export const MAX_RANGE_YEARS = 5;

/**
 * Split an inclusive `YYYY-MM-DD` range into adjacent, non-overlapping windows of
 * at most `maxYears` each. Returns a single window for short or invalid ranges.
 */
export function splitDateRange(
	from: string,
	to: string,
	maxYears: number = MAX_RANGE_YEARS
): Array<{ from: string; to: string }> {
	const start = Date.parse(`${from}T00:00:00Z`);
	const end = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return [{ from, to }];
	const DAY = 86_400_000;
	const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
	const windows: Array<{ from: string; to: string }> = [];
	let s = start;
	while (s <= end) {
		const sd = new Date(s);
		const capped =
			Date.UTC(sd.getUTCFullYear() + maxYears, sd.getUTCMonth(), sd.getUTCDate()) - DAY;
		const e = Math.min(capped, end);
		windows.push({ from: ymd(s), to: ymd(e) });
		s = e + DAY;
	}
	return windows;
}
