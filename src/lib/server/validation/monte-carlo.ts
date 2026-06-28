/**
 * Monte-Carlo robustness tests (spec §6). All seeded and deterministic.
 *
 * Three independent questions:
 *  1. shuffleTradeOrder  — is the equity path / drawdown an artifact of the
 *     ORDER trades happened to arrive in? Reshuffle and look at the spread.
 *  2. bootstrapReturns   — how uncertain is total return given the trade-return
 *     DISTRIBUTION? Resample with replacement.
 *  3. randomizedEntryNull — does the strategy actually beat RANDOM entries with
 *     the same trade count and average holding period? If a coin-flip on the
 *     same bars does as well, there is no edge. The strategy must clear a high
 *     percentile of this null distribution.
 */

import { makeRng, shuffle, sampleWithReplacement } from './rng';
import { percentile, rankOf, mean } from './stats';

/** Equity-path summary for one simulated sequence of per-trade returns. */
function pathStats(tradeReturns: number[], startEquity: number): { total: number; maxDD: number } {
	let equity = startEquity;
	let peak = startEquity;
	let maxDD = 0;
	for (const r of tradeReturns) {
		equity *= 1 + r;
		if (equity > peak) peak = equity;
		const dd = peak > 0 ? equity / peak - 1 : 0;
		if (dd < maxDD) maxDD = dd;
	}
	return { total: equity / startEquity - 1, maxDD };
}

export interface MonteCarloResult {
	iterations: number;
	/** Observed metric on the real sequence. */
	observed: number;
	/** Distribution percentiles of the simulated metric. */
	p05: number;
	p50: number;
	p95: number;
	/** Empirical rank of the observed value within the simulated distribution. */
	observedRank: number;
}

/**
 * Reshuffle trade ORDER many times; report the distribution of max drawdown.
 * A path-dependent strategy whose real drawdown sits in the benign tail is
 * fragile — most orderings are worse.
 */
export function shuffleTradeOrder(
	tradeReturns: number[],
	startEquity: number,
	iterations = 1000,
	seed = 1
): MonteCarloResult {
	const rng = makeRng(seed);
	const observed = pathStats(tradeReturns, startEquity).maxDD;
	const sims: number[] = [];
	for (let i = 0; i < iterations; i++) {
		sims.push(pathStats(shuffle(tradeReturns, rng), startEquity).maxDD);
	}
	return {
		iterations,
		observed,
		p05: percentile(sims, 0.05),
		p50: percentile(sims, 0.5),
		p95: percentile(sims, 0.95),
		observedRank: rankOf(sims, observed)
	};
}

/**
 * Bootstrap the trade-return distribution; report the spread of TOTAL return.
 * Wide, straddling-zero intervals mean the headline return is luck.
 */
export function bootstrapReturns(
	tradeReturns: number[],
	startEquity: number,
	iterations = 1000,
	seed = 2
): MonteCarloResult {
	const rng = makeRng(seed);
	const observed = pathStats(tradeReturns, startEquity).total;
	const n = tradeReturns.length;
	const sims: number[] = [];
	for (let i = 0; i < iterations; i++) {
		sims.push(pathStats(sampleWithReplacement(tradeReturns, n, rng), startEquity).total);
	}
	return {
		iterations,
		observed,
		p05: percentile(sims, 0.05),
		p50: percentile(sims, 0.5),
		p95: percentile(sims, 0.95),
		observedRank: rankOf(sims, observed)
	};
}

export interface RandomizedEntryResult extends MonteCarloResult {
	/** True when the strategy beats the null's 95th percentile. */
	pass: boolean;
	/** Mean total return of the random-entry null. */
	nullMean: number;
}

/**
 * Randomized-entry NULL baseline. Given the bar-to-bar returns of the traded
 * instrument, simulate `iterations` strategies that take the SAME number of
 * trades with the SAME average holding period but at RANDOM entry points, and
 * compare the real strategy's total return against that distribution.
 *
 * @param barReturns   per-bar simple returns of the instrument over the period
 * @param nTrades      number of trades the real strategy took
 * @param avgHoldBars  average holding period (bars) of the real trades
 * @param observedTotalReturn  the real strategy's total return (fraction)
 */
export function randomizedEntryNull(
	barReturns: number[],
	nTrades: number,
	avgHoldBars: number,
	observedTotalReturn: number,
	iterations = 1000,
	seed = 3
): RandomizedEntryResult {
	const rng = makeRng(seed);
	const bars = barReturns.length;
	const hold = Math.max(1, Math.round(avgHoldBars));
	const sims: number[] = [];

	if (bars > hold && nTrades > 0) {
		for (let it = 0; it < iterations; it++) {
			let equity = 1;
			for (let k = 0; k < nTrades; k++) {
				// Random entry bar; hold `hold` bars, compounding bar returns long.
				const start = rng.int(Math.max(1, bars - hold));
				for (let b = start; b < start + hold && b < bars; b++) {
					equity *= 1 + barReturns[b];
				}
			}
			sims.push(equity - 1);
		}
	}

	const p95 = sims.length ? percentile(sims, 0.95) : 0;
	return {
		iterations,
		observed: observedTotalReturn,
		p05: sims.length ? percentile(sims, 0.05) : 0,
		p50: sims.length ? percentile(sims, 0.5) : 0,
		p95,
		observedRank: sims.length ? rankOf(sims, observedTotalReturn) : NaN,
		nullMean: sims.length ? mean(sims) : 0,
		pass: sims.length > 0 && observedTotalReturn > p95
	};
}
