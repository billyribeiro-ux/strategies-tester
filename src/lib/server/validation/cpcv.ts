/**
 * Combinatorial Purged Cross-Validation — CPCV (López de Prado, 2018). Spec §6.
 *
 * Plain k-fold leaks in time series: training samples adjacent to the test fold
 * share information with it (overlapping label windows, serial correlation).
 * CPCV (a) tests every combination of N choose k folds, giving many backtest
 * paths instead of one, and (b) PURGES training samples within a horizon of any
 * test block and EMBARGOES a span immediately AFTER each test block, so no
 * training observation can peek across the boundary.
 */

import { combinations } from './pbo';

export interface CpcvSplit {
	/** Indices of the groups assigned to the test set for this split. */
	testGroups: number[];
	/** Sorted observation indices in the test set. */
	test: number[];
	/** Sorted observation indices in the (purged + embargoed) training set. */
	train: number[];
}

export interface CpcvOptions {
	/** Bars to purge on BOTH sides of each test block (label-overlap horizon). */
	purgeBars?: number;
	/** Extra bars to drop from training immediately AFTER each test block. */
	embargoBars?: number;
}

/** Contiguous [lo, hi) group boundaries partitioning [0, n). */
export function groupBounds(n: number, nGroups: number): [number, number][] {
	const bounds: [number, number][] = [];
	for (let g = 0; g < nGroups; g++) {
		const lo = Math.floor((g * n) / nGroups);
		const hi = Math.floor(((g + 1) * n) / nGroups);
		bounds.push([lo, hi]);
	}
	return bounds;
}

/**
 * Generate all CPCV splits for `n` observations partitioned into `nGroups`
 * contiguous groups, choosing `nTestGroups` as test each time.
 */
export function generateCpcvSplits(
	n: number,
	nGroups: number,
	nTestGroups: number,
	options: CpcvOptions = {}
): CpcvSplit[] {
	if (nGroups < 2) throw new Error('CPCV needs at least 2 groups.');
	if (nTestGroups < 1 || nTestGroups >= nGroups) {
		throw new Error('nTestGroups must be in [1, nGroups - 1].');
	}
	const purge = Math.max(0, Math.floor(options.purgeBars ?? 0));
	const embargo = Math.max(0, Math.floor(options.embargoBars ?? 0));
	const bounds = groupBounds(n, nGroups);

	return combinations(nGroups, nTestGroups).map((testGroups) => {
		const testSet = new Set<number>();
		// Forbidden = test indices plus their purge/embargo halos.
		const forbidden = new Set<number>();
		for (const g of testGroups) {
			const [lo, hi] = bounds[g];
			for (let i = lo; i < hi; i++) testSet.add(i);
			const from = Math.max(0, lo - purge);
			const to = Math.min(n, hi + purge + embargo); // embargo extends the right halo
			for (let i = from; i < to; i++) forbidden.add(i);
		}
		const test = [...testSet].sort((a, b) => a - b);
		const train: number[] = [];
		for (let i = 0; i < n; i++) if (!forbidden.has(i)) train.push(i);
		return { testGroups, test, train };
	});
}
