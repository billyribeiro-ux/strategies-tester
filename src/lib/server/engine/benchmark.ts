/** Buy-and-hold benchmark — PURE. Normalizes a symbol's closes to initial capital. */

import type { BenchmarkResult, Candle } from '$lib/types';

export function computeBenchmark(
	symbol: string,
	candles: Candle[],
	initialCapital: number
): BenchmarkResult {
	const valid = candles
		.filter((c) => Number.isFinite(c.c) && c.c > 0)
		.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
	if (valid.length === 0) return { symbol, equity: [], returnPct: 0 };

	const first = valid[0].c;
	const shares = first > 0 ? initialCapital / first : 0;
	const equity = valid.map((c) => ({ t: c.t, equity: shares * c.c }));
	const last = valid[valid.length - 1].c;
	const returnPct = first > 0 ? last / first - 1 : 0;
	return { symbol, equity, returnPct };
}
