/**
 * ExplicitListProvider — a fixed, user-supplied list of symbols.
 *
 * Pure (no network): the same symbols are returned for ANY date. This is the
 * simplest universe and is useful for a hand-picked watchlist, but it is NOT
 * survivorship-free: an explicit list of *current* names cannot include
 * companies that were delisted/removed before the list was authored, so any
 * backtest over it inherits survivorship bias. `resolve` therefore always
 * emits a {@link CoverageGap} documenting this limitation so it is auditable.
 */

import type { CoverageGap, FetchFn, UniverseMembership, UniverseProvider } from './types';

/** Normalize, upper-case, trim, de-duplicate and sort a raw symbol list. */
function normalizeSymbols(symbols: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const raw of symbols) {
		const s = raw.trim().toUpperCase();
		if (s) seen.add(s);
	}
	return [...seen].sort();
}

export class ExplicitListProvider implements UniverseProvider {
	readonly id = 'explicit';
	private readonly symbols: string[];

	constructor(symbols: readonly string[]) {
		this.symbols = normalizeSymbols(symbols);
	}

	/**
	 * The fixed list, for any date. `dateISO` / `fetchFn` are accepted to satisfy
	 * {@link UniverseProvider} but ignored (this is pure).
	 */
	async membersAt(dateISO: string, fetchFn?: FetchFn): Promise<string[]> {
		void dateISO;
		void fetchFn;
		return [...this.symbols];
	}

	/**
	 * A single membership snapshot covering the whole range (the list is static),
	 * plus a survivorship warning gap. `toISO` / `fetchFn` are ignored (pure).
	 */
	async resolve(
		fromISO: string,
		toISO?: string,
		fetchFn?: FetchFn
	): Promise<{ membership: UniverseMembership[]; gaps: CoverageGap[] }> {
		void toISO;
		void fetchFn;
		const membership: UniverseMembership[] = [{ date: fromISO, symbols: [...this.symbols] }];
		const gaps: CoverageGap[] = [
			{
				detail:
					'Explicit symbol list is NOT survivorship-free: it is a fixed set and cannot ' +
					'include names that were delisted or removed before the list was authored. ' +
					'Backtests over it inherit survivorship bias.'
			}
		];
		return { membership, gaps };
	}
}
