/**
 * Source-agnostic, point-in-time (PIT) UNIVERSE contract.
 *
 * A universe answers "which symbols were members of this index/list AS OF a
 * given date?" — the data needed to run a survivorship-bias-free backtest. The
 * interface is deliberately provider-agnostic: an explicit hard-coded list, an
 * FMP-backed historical constituent feed, or any future source all satisfy the
 * same shape so the engine never couples to a vendor.
 *
 * Everything is async + `fetchFn`-injectable so providers stay pure of ambient
 * globals and are unit-testable with a stub `fetch`. Pure providers ignore the
 * injected `fetchFn`.
 */

/** Injectable fetch — same shape the FMP client uses, so stubs are trivial. */
export type FetchFn = typeof fetch;

/**
 * Constituent set effective AT a single point in time. `date` is an inclusive
 * `YYYY-MM-DD` from which `symbols` are members until the next membership entry
 * (or the end of the resolved range). `symbols` are de-duplicated and sorted.
 */
export interface UniverseMembership {
	date: string;
	symbols: string[];
}

/**
 * A non-fatal coverage problem surfaced to the caller (audit record) rather
 * than thrown. Examples: the provider could not reach a constituents endpoint,
 * a window had no data, or the source is structurally not survivorship-free.
 */
export interface CoverageGap {
	detail: string;
}

/**
 * A point-in-time universe source. Implementations MUST be best-effort and
 * non-throwing for coverage problems — they push a {@link CoverageGap} instead,
 * so a partial universe is still usable and the gaps are auditable.
 */
export interface UniverseProvider {
	/** Stable identifier for the source (e.g. `'explicit'`, `'fmp-pit:sp500'`). */
	id: string;
	/** Symbols that were members AS OF `dateISO` (`YYYY-MM-DD`). */
	membersAt(dateISO: string, fetchFn?: FetchFn): Promise<string[]>;
	/**
	 * Resolve membership across an inclusive `[fromISO, toISO]` range. Returns an
	 * ascending list of membership snapshots plus any coverage gaps encountered.
	 */
	resolve(
		fromISO: string,
		toISO: string,
		fetchFn?: FetchFn
	): Promise<{ membership: UniverseMembership[]; gaps: CoverageGap[] }>;
}
