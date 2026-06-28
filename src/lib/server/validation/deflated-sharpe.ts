/**
 * Probabilistic & Deflated Sharpe Ratio (spec §6).
 *
 * The Sharpe ratio of the *best* of many trials is upward-biased: try enough
 * configurations and one will look great by luck. The Deflated Sharpe Ratio
 * (Bailey & López de Prado, 2014) discounts the observed Sharpe by the number of
 * trials and the non-normality of returns, returning the probability that the
 * TRUE Sharpe exceeds a benchmark — here, the Sharpe you'd expect from the best
 * of N random trials. DSR > 0.95 is a strong result; DSR near 0.5 or below means
 * the edge is indistinguishable from overfitting noise.
 *
 * All per-period (not annualized); annualization cancels in the ratios used.
 */

import { sharpe, skewness, kurtosis, normalCdf, normalInv, EULER_MASCHERONI } from './stats';

/**
 * Probabilistic Sharpe Ratio: P(true SR > srBenchmark) given the observed
 * sample. Corrects for sample length, skew and kurtosis (fat tails inflate
 * Sharpe uncertainty).
 *
 * @param sr            observed per-period Sharpe
 * @param n             number of return observations
 * @param skew          sample skewness of returns
 * @param kurt          sample (Pearson) kurtosis of returns (normal = 3)
 * @param srBenchmark   Sharpe to beat (default 0)
 */
export function probabilisticSharpe(
	sr: number,
	n: number,
	skew: number,
	kurt: number,
	srBenchmark = 0
): number {
	if (n < 2) return NaN;
	// Denominator: standard error of the Sharpe estimator under non-normality.
	const denom = Math.sqrt(1 - skew * sr + ((kurt - 1) / 4) * sr * sr);
	if (!(denom > 0)) return NaN;
	const z = ((sr - srBenchmark) * Math.sqrt(n - 1)) / denom;
	return normalCdf(z);
}

/**
 * Expected MAXIMUM Sharpe ratio under the null (true SR = 0) across `nTrials`
 * independent trials, given the cross-trial variance of the Sharpe estimates.
 * This is the benchmark the Deflated Sharpe must beat.
 *
 * E[max] ≈ √V · [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]
 */
export function expectedMaxSharpe(varianceOfSharpes: number, nTrials: number): number {
	const N = Math.max(1, Math.floor(nTrials));
	if (N === 1) return 0;
	const v = Math.sqrt(Math.max(0, varianceOfSharpes));
	const a = normalInv(1 - 1 / N);
	const b = normalInv(1 - 1 / (N * Math.E));
	return v * ((1 - EULER_MASCHERONI) * a + EULER_MASCHERONI * b);
}

export interface DeflatedSharpeResult {
	/** Observed per-period Sharpe of the selected strategy. */
	sharpe: number;
	/** Probabilistic Sharpe vs a zero benchmark. */
	psr: number;
	/** The expected best-of-N Sharpe under the null. */
	expectedMaxSharpe: number;
	/** Deflated Sharpe: P(true SR > expectedMaxSharpe). The headline number. */
	dsr: number;
	nTrials: number;
	nObservations: number;
	skew: number;
	kurtosis: number;
	/** True when DSR clears the conventional 0.95 confidence bar. */
	pass: boolean;
}

/**
 * Compute the Deflated Sharpe Ratio for a selected strategy's return series.
 *
 * @param returns               the SELECTED strategy's per-period returns
 * @param nTrials               number of configurations searched to find it
 * @param varianceOfSharpes     variance of Sharpe estimates across those trials
 *                              (if unknown, pass the sampling-variance proxy 1/(n-1))
 */
export function deflatedSharpe(
	returns: number[],
	nTrials: number,
	varianceOfSharpes?: number
): DeflatedSharpeResult {
	const n = returns.length;
	const sr = sharpe(returns);
	const skew = skewness(returns);
	const kurt = kurtosis(returns);
	// Default cross-trial variance proxy: the sampling variance of a single
	// Sharpe estimate under the null, ≈ 1/(n-1).
	const v = varianceOfSharpes ?? (n > 1 ? 1 / (n - 1) : 0);
	const srStar = expectedMaxSharpe(v, nTrials);
	const psr = probabilisticSharpe(sr, n, skew, kurt, 0);
	const dsr = probabilisticSharpe(sr, n, skew, kurt, srStar);
	return {
		sharpe: sr,
		psr,
		expectedMaxSharpe: srStar,
		dsr,
		nTrials,
		nObservations: n,
		skew,
		kurtosis: kurt,
		pass: Number.isFinite(dsr) && dsr > 0.95
	};
}
