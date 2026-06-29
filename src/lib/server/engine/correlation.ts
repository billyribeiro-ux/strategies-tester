/**
 * Correlation helpers for the §5 portfolio correlation-exposure limit — PURE.
 *
 * The engine uses these to decide whether a NEW position on ticker X is too
 * correlated with any already-open position on a different ticker Y. Everything
 * here is point-in-time: callers pass only close-to-close returns derived from
 * bars at or before the entry decision time, so no future data can leak in.
 */

/**
 * Close-to-close simple returns of a price series: `r[i] = c[i]/c[i-1] − 1` for
 * `i ≥ 1`. The output has `closes.length − 1` entries (empty for < 2 closes). A
 * non-finite or ≤ 0 previous close yields a `0` return for that step (defensive;
 * real candle closes are positive).
 */
export function closeReturns(closes: number[]): number[] {
	const out: number[] = [];
	for (let i = 1; i < closes.length; i++) {
		const prev = closes[i - 1];
		const cur = closes[i];
		out.push(Number.isFinite(prev) && prev > 0 && Number.isFinite(cur) ? cur / prev - 1 : 0);
	}
	return out;
}

/**
 * Pearson correlation coefficient of two equal-length numeric vectors in
 * [-1, 1]. Returns `NaN` when it is undefined: a length mismatch, fewer than 2
 * paired observations, or zero variance in either vector (a flat series has no
 * correlation to anything). Pure and deterministic.
 */
export function pearson(a: number[], b: number[]): number {
	const n = a.length;
	if (n !== b.length || n < 2) return NaN;
	let sumA = 0;
	let sumB = 0;
	for (let i = 0; i < n; i++) {
		sumA += a[i];
		sumB += b[i];
	}
	const meanA = sumA / n;
	const meanB = sumB / n;
	let cov = 0;
	let varA = 0;
	let varB = 0;
	for (let i = 0; i < n; i++) {
		const da = a[i] - meanA;
		const db = b[i] - meanB;
		cov += da * db;
		varA += da * da;
		varB += db * db;
	}
	if (!(varA > 0) || !(varB > 0)) return NaN; // zero variance → undefined
	const r = cov / Math.sqrt(varA * varB);
	// Guard against tiny floating-point overshoot beyond [-1, 1].
	if (r > 1) return 1;
	if (r < -1) return -1;
	return r;
}
