/**
 * Pure statistical primitives for the validation suite (spec §6/§7).
 *
 * Everything here is deterministic and dependency-free. Moments use population
 * formulas (López de Prado's PSR/DSR convention); Sharpe uses the sample std.
 * `normalCdf`/`normalInv` are closed-form approximations accurate enough for the
 * tail probabilities the validation suite reports.
 */

export function mean(xs: number[]): number {
	if (xs.length === 0) return NaN;
	let s = 0;
	for (const x of xs) s += x;
	return s / xs.length;
}

/** Sample variance (ddof = 1). NaN for fewer than 2 points. */
export function variance(xs: number[]): number {
	const n = xs.length;
	if (n < 2) return NaN;
	const m = mean(xs);
	let s = 0;
	for (const x of xs) s += (x - m) ** 2;
	return s / (n - 1);
}

export function stdDev(xs: number[]): number {
	return Math.sqrt(variance(xs));
}

/** Population skewness (m3 / m2^1.5). 0 for a symmetric distribution. */
export function skewness(xs: number[]): number {
	const n = xs.length;
	if (n < 3) return 0;
	const m = mean(xs);
	let m2 = 0;
	let m3 = 0;
	for (const x of xs) {
		const d = x - m;
		m2 += d * d;
		m3 += d * d * d;
	}
	m2 /= n;
	m3 /= n;
	if (m2 === 0) return 0;
	return m3 / m2 ** 1.5;
}

/** Population (Pearson) kurtosis (m4 / m2^2). Normal distribution = 3. */
export function kurtosis(xs: number[]): number {
	const n = xs.length;
	if (n < 4) return 3;
	const m = mean(xs);
	let m2 = 0;
	let m4 = 0;
	for (const x of xs) {
		const d = x - m;
		const d2 = d * d;
		m2 += d2;
		m4 += d2 * d2;
	}
	m2 /= n;
	m4 /= n;
	if (m2 === 0) return 3;
	return m4 / (m2 * m2);
}

/** Per-period Sharpe ratio (mean / sample std). 0 when std is 0 or undefined. */
export function sharpe(returns: number[], riskFreePerPeriod = 0): number {
	if (returns.length < 2) return 0;
	const excess = riskFreePerPeriod === 0 ? returns : returns.map((r) => r - riskFreePerPeriod);
	const sd = stdDev(excess);
	if (!(sd > 0)) return 0;
	return mean(excess) / sd;
}

/** Per-period Sortino ratio (mean / downside deviation about the target). */
export function sortino(returns: number[], targetPerPeriod = 0): number {
	if (returns.length < 2) return 0;
	let dsq = 0;
	let count = 0;
	for (const r of returns) {
		const d = r - targetPerPeriod;
		if (d < 0) {
			dsq += d * d;
			count++;
		}
	}
	if (count === 0) return 0;
	const dd = Math.sqrt(dsq / count);
	if (!(dd > 0)) return 0;
	return (mean(returns) - targetPerPeriod) / dd;
}

/**
 * Percentile (0..1) of a sorted-or-unsorted sample via linear interpolation
 * between closest ranks (the "linear"/type-7 method).
 */
export function percentile(xs: number[], p: number): number {
	if (xs.length === 0) return NaN;
	if (xs.length === 1) return xs[0];
	const sorted = [...xs].sort((a, b) => a - b);
	const clamped = Math.min(1, Math.max(0, p));
	const idx = clamped * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	const frac = idx - lo;
	return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Fraction of `xs` strictly less than `value` — the empirical rank of `value`. */
export function rankOf(xs: number[], value: number): number {
	if (xs.length === 0) return NaN;
	let below = 0;
	for (const x of xs) if (x < value) below++;
	return below / xs.length;
}

/** Error function (Abramowitz & Stegun 7.1.26), |error| < 1.5e-7. */
export function erf(x: number): number {
	const sign = x < 0 ? -1 : 1;
	const ax = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * ax);
	const y =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
			t *
			Math.exp(-ax * ax);
	return sign * y;
}

/** Standard normal CDF. */
export function normalCdf(x: number): number {
	return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Inverse standard normal CDF (Acklam's algorithm). Accurate to ~1.15e-9.
 * `p` is clamped to the open interval (0,1).
 */
export function normalInv(p: number): number {
	const pp = Math.min(1 - 1e-15, Math.max(1e-15, p));
	const a = [
		-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
		-3.066479806614716e1, 2.506628277459239
	];
	const b = [
		-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
		-1.328068155288572e1
	];
	const c = [
		-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
		4.374664141464968, 2.938163982698783
	];
	const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
	const plow = 0.02425;
	const phigh = 1 - plow;
	let q: number;
	let r: number;
	if (pp < plow) {
		q = Math.sqrt(-2 * Math.log(pp));
		return (
			(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
			((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
		);
	}
	if (pp <= phigh) {
		q = pp - 0.5;
		r = q * q;
		return (
			((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
			(((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
		);
	}
	q = Math.sqrt(-2 * Math.log(1 - pp));
	return (
		-(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
		((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
	);
}

/** Euler–Mascheroni constant, used by the expected-maximum-Sharpe estimator. */
export const EULER_MASCHERONI = 0.5772156649015329;
