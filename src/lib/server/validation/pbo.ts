/**
 * Probability of Backtest Overfit (PBO) via Combinatorially-Symmetric
 * Cross-Validation — CSCV (Bailey, Borwein, López de Prado, Zhu 2017). Spec §6.
 *
 * Given a set of strategy configurations evaluated over the same period, split
 * time into S blocks and, for every way of choosing S/2 blocks as in-sample (IS)
 * and the rest as out-of-sample (OOS): pick the config that's best IS, then see
 * where it ranks OOS. If the IS-winner routinely lands below the OOS median, the
 * selection process is overfitting. PBO is the fraction of splits where that
 * happens. PBO < 0.5 is the pass bar; lower is better.
 */

import { sharpe, rankOf } from './stats';

/** All ways to choose `k` indices from [0, n). Iterative, lexicographic. */
export function combinations(n: number, k: number): number[][] {
	const out: number[][] = [];
	if (k < 0 || k > n) return out;
	const idx = Array.from({ length: k }, (_, i) => i);
	while (true) {
		out.push(idx.slice());
		let i = k - 1;
		while (i >= 0 && idx[i] === n - k + i) i--;
		if (i < 0) break;
		idx[i]++;
		for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
	}
	return out;
}

/**
 * Build a configuration × block performance matrix from each trial's full return
 * series. Every trial's returns are split into `nBlocks` contiguous blocks and
 * scored by per-block Sharpe. All trials must share the same length.
 */
export function buildPerformanceMatrix(trialReturns: number[][], nBlocks: number): number[][] {
	if (trialReturns.length === 0) return [];
	const len = trialReturns[0].length;
	for (const r of trialReturns) {
		if (r.length !== len) throw new Error('All trials must have the same number of returns.');
	}
	const bounds: [number, number][] = [];
	for (let b = 0; b < nBlocks; b++) {
		const lo = Math.floor((b * len) / nBlocks);
		const hi = Math.floor(((b + 1) * len) / nBlocks);
		bounds.push([lo, hi]);
	}
	return trialReturns.map((r) => bounds.map(([lo, hi]) => sharpe(r.slice(lo, hi))));
}

export interface PboResult {
	/** Probability of backtest overfit: fraction of splits where the IS-best config is below the OOS median. */
	pbo: number;
	nSplits: number;
	nConfigs: number;
	nBlocks: number;
	/** OOS logit of the IS-best config per split (negative ⇒ overfit on that split). */
	logits: number[];
	/** True when PBO < 0.5. */
	pass: boolean;
}

/**
 * Compute PBO from a configuration × block performance matrix.
 * `matrix[c][b]` = performance of config `c` in block `b` (higher is better).
 */
export function computePBO(matrix: number[][], maxSplits = 100_000): PboResult {
	const nConfigs = matrix.length;
	const nBlocks = nConfigs > 0 ? matrix[0].length : 0;
	if (nConfigs < 2) throw new Error('PBO needs at least 2 configurations.');
	if (nBlocks < 2) throw new Error('PBO needs at least 2 blocks.');

	// Use an even number of blocks so IS and OOS are equal halves.
	const S = nBlocks % 2 === 0 ? nBlocks : nBlocks - 1;
	const half = S / 2;
	const isSets = combinations(S, half);
	if (isSets.length > maxSplits) {
		throw new Error(
			`CSCV would enumerate ${isSets.length} splits (> ${maxSplits}); use fewer blocks.`
		);
	}

	const logits: number[] = [];
	let overfit = 0;

	for (const isBlocks of isSets) {
		const inSet = new Set(isBlocks);
		// Mean performance per config across IS blocks and across OOS blocks.
		let bestConfig = 0;
		let bestIs = -Infinity;
		const oosPerf: number[] = new Array(nConfigs).fill(0);

		for (let c = 0; c < nConfigs; c++) {
			let isSum = 0;
			let isCount = 0;
			let oosSum = 0;
			let oosCount = 0;
			for (let b = 0; b < S; b++) {
				const v = matrix[c][b];
				if (inSet.has(b)) {
					isSum += v;
					isCount++;
				} else {
					oosSum += v;
					oosCount++;
				}
			}
			const isMean = isCount > 0 ? isSum / isCount : -Infinity;
			oosPerf[c] = oosCount > 0 ? oosSum / oosCount : -Infinity;
			if (isMean > bestIs) {
				bestIs = isMean;
				bestConfig = c;
			}
		}

		// Relative OOS rank of the IS-best config in [0,1] (1 = best OOS).
		const rel = rankOf(oosPerf, oosPerf[bestConfig]);
		const w = Math.min(1 - 1e-9, Math.max(1e-9, rel));
		const logit = Math.log(w / (1 - w));
		logits.push(logit);
		if (logit <= 0) overfit++; // IS-best is at/below the OOS median
	}

	const pbo = isSets.length > 0 ? overfit / isSets.length : NaN;
	return { pbo, nSplits: isSets.length, nConfigs, nBlocks: S, logits, pass: pbo < 0.5 };
}
