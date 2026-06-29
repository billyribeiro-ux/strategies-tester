/**
 * Pure selection of a concrete, capped ticker set from point-in-time universe
 * membership snapshots — the deterministic bridge between a survivorship-free
 * `resolve(...)` result and the finite list of symbols a backtest can fetch.
 *
 * Point-in-time / leak-safe: we only union the symbols across snapshots whose
 * effective `date` falls within the run window `[from, to]`, so a run never
 * "sees" members from outside its own window. (The providers already replay
 * membership backwards, so each snapshot is correct as of its date.) The union
 * is the set of names that were members at ANY point during the window —
 * survivorship-free, since delisted/removed names that were live in the window
 * are folded into the snapshots by the provider.
 *
 * The cap is deterministic: symbols are sorted ascending and the first `n` are
 * taken, so the same membership always yields the same ticker set (stable runs,
 * reproducible audits). Has no I/O and no dependency on the provider — trivially
 * unit-testable.
 */

import type { UniverseMembership } from './types';

export interface UniverseSelection {
	/** De-duplicated, sorted, capped symbols to trade. */
	symbols: string[];
	/** True iff the cap discarded symbols (the union was larger than `maxSymbols`). */
	capped: boolean;
}

/**
 * Union the symbols of every membership snapshot whose `date` is within the
 * inclusive `[from, to]` window, de-duplicate, sort ascending, then cap to the
 * first `maxSymbols`. Pure and deterministic.
 *
 * @param membership ascending membership snapshots from a provider's `resolve`
 * @param from inclusive window start (`YYYY-MM-DD`)
 * @param to inclusive window end (`YYYY-MM-DD`)
 * @param maxSymbols hard cap on the returned set; must be ≥ 1
 */
export function selectUniverseSymbols(
	membership: readonly UniverseMembership[],
	from: string,
	to: string,
	maxSymbols: number
): UniverseSelection {
	const union = new Set<string>();
	for (const snap of membership) {
		// In-range only: never include a snapshot from outside the run window.
		if (snap.date < from || snap.date > to) continue;
		for (const raw of snap.symbols) {
			const sym = raw.trim().toUpperCase();
			if (sym) union.add(sym);
		}
	}
	const sorted = [...union].sort((a, b) => a.localeCompare(b));
	const cap = Number.isFinite(maxSymbols) && maxSymbols >= 1 ? Math.floor(maxSymbols) : 0;
	const capped = sorted.length > cap;
	return { symbols: capped ? sorted.slice(0, cap) : sorted, capped };
}
