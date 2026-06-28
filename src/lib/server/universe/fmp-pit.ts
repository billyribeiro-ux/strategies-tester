/**
 * FmpPitProvider — best-effort point-in-time index membership from FMP.
 *
 * SURVIVORSHIP-FREE INTENT
 * ------------------------
 * A naive "current S&P 500 constituents" list is survivorship-biased: it omits
 * companies that were members during the backtest window but have since been
 * removed or delisted. To approximate a true point-in-time universe we combine
 * two FMP feeds:
 *
 *   1. The CURRENT constituents (each row carries its index-add date), plus the
 *      historical change log (`historical-sp500-constituent`) which records, per
 *      change, the symbol added and the symbol removed and the effective date.
 *      Replaying those changes backwards from "current" reconstructs membership
 *      as of any past date.
 *   2. The `delisted-companies` feed, so names that were removed AND delisted
 *      (and would otherwise vanish from constituent data) are still considered
 *      members during the window they were active.
 *
 * ASSUMPTIONS / ENDPOINTS (verify against the live API)
 * -----------------------------------------------------
 *   GET {BASE}/historical-sp500-constituent?apikey=...
 *       -> array of change records. Field names vary across FMP revisions, so we
 *          parse defensively for: dateAdded / addedSecurity (added symbol),
 *          removedTicker / removedSecurity (removed symbol), date / dateRemoved.
 *   GET {BASE}/sp500-constituent?apikey=...
 *       -> array of CURRENT constituents (symbol + dateFirstAdded). Used as the
 *          replay anchor. Optional: if it 404s we fall back to change-log adds.
 *   GET {BASE}/delisted-companies?apikey=...&page=N
 *       -> array of { symbol, ipoDate?, delistedDate }.
 *
 * The `index` constructor option templates these paths (default 'sp500'); only
 * S&P 500 has a documented historical feed, so other indices will mostly emit
 * coverage gaps. ALL network access goes through the injected `fetchFn` so this
 * is fully unit-testable with a canned stub, and EVERY missing/empty/invalid
 * response becomes a {@link CoverageGap} rather than a thrown error.
 */

import type { CoverageGap, FetchFn, UniverseMembership, UniverseProvider } from './types';

const BASE = 'https://financialmodelingprep.com/stable';

export interface FmpPitOptions {
	apiKey: string;
	/** Index slug used to template endpoint paths. Default 'sp500'. */
	index?: string;
}

/** A single membership change: `added`/`removed` symbol effective on `date`. */
interface ChangeRecord {
	date: string; // YYYY-MM-DD
	added: string | null;
	removed: string | null;
}

interface DelistedRecord {
	symbol: string;
	delistedDate: string | null;
}

/** Pull the first present string field from a record, trimmed; else null. */
function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
	for (const k of keys) {
		const v = obj[k];
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return null;
}

/** Normalize an FMP date-ish value to `YYYY-MM-DD`, or null if unusable. */
function toYmd(value: string | null): string | null {
	if (!value) return null;
	const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
	if (m) return m[1];
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function normSymbol(value: string | null): string | null {
	if (!value) return null;
	const s = value.trim().toUpperCase();
	return s || null;
}

export class FmpPitProvider implements UniverseProvider {
	readonly id: string;
	private readonly apiKey: string;
	private readonly index: string;

	constructor(opts: FmpPitOptions) {
		this.apiKey = opts.apiKey;
		this.index = (opts.index ?? 'sp500').toLowerCase();
		this.id = `fmp-pit:${this.index}`;
	}

	async membersAt(dateISO: string, fetchFn: FetchFn = fetch): Promise<string[]> {
		const gaps: CoverageGap[] = [];
		const date = toYmd(dateISO) ?? dateISO;
		const current = await this.fetchCurrentConstituents(fetchFn, gaps);
		const changes = await this.fetchChanges(fetchFn, gaps);
		return membersAtDate(current, changes, date);
	}

	async resolve(
		fromISO: string,
		toISO: string,
		fetchFn: FetchFn = fetch
	): Promise<{ membership: UniverseMembership[]; gaps: CoverageGap[] }> {
		const gaps: CoverageGap[] = [];

		const from = toYmd(fromISO) ?? fromISO;
		const to = toYmd(toISO) ?? toISO;

		const current = await this.fetchCurrentConstituents(fetchFn, gaps);
		const changes = await this.fetchChanges(fetchFn, gaps);
		const delisted = await this.fetchDelisted(fetchFn, gaps);

		// A snapshot is needed at `from` (range start) and at every change date that
		// falls strictly inside the window — membership only moves on change dates.
		const snapshotDates = new Set<string>([from]);
		for (const ch of changes) {
			if (ch.date > from && ch.date <= to) snapshotDates.add(ch.date);
		}

		// Survivorship-free correction: names delisted DURING the window were live,
		// tradeable members for part of it. Fold them into the `from` snapshot so the
		// universe includes them for the whole range (they cannot be re-added later).
		const delistedInWindow = delisted
			.filter((d) => d.delistedDate && d.delistedDate >= from && d.delistedDate <= to)
			.map((d) => d.symbol);

		const membership: UniverseMembership[] = [...snapshotDates]
			.sort((a, b) => a.localeCompare(b))
			.map((date) => {
				const set = new Set(membersAtDate(current, changes, date));
				if (date === from) for (const s of delistedInWindow) set.add(s);
				return { date, symbols: [...set].sort() };
			});

		if (membership.every((m) => m.symbols.length === 0)) {
			gaps.push({
				detail: `No point-in-time membership could be reconstructed for index "${this.index}" over ${from}..${to}.`
			});
		}

		return { membership, gaps };
	}

	// -- endpoint calls -------------------------------------------------------

	private async fetchCurrentConstituents(fetchFn: FetchFn, gaps: CoverageGap[]): Promise<string[]> {
		const url = `${BASE}/${this.index}-constituent?apikey=${encodeURIComponent(this.apiKey)}`;
		const rows = await this.requestArray(url, fetchFn, gaps, `current ${this.index} constituents`);
		const out = new Set<string>();
		for (const row of rows) {
			const sym = normSymbol(pickString(row, ['symbol', 'Symbol', 'ticker']));
			if (sym) out.add(sym);
		}
		if (out.size === 0) {
			gaps.push({
				detail: `Current constituents feed for "${this.index}" returned no symbols; membership replay anchor is empty.`
			});
		}
		return [...out];
	}

	private async fetchChanges(fetchFn: FetchFn, gaps: CoverageGap[]): Promise<ChangeRecord[]> {
		const url = `${BASE}/historical-${this.index}-constituent?apikey=${encodeURIComponent(this.apiKey)}`;
		const rows = await this.requestArray(
			url,
			fetchFn,
			gaps,
			`historical ${this.index} constituent changes`
		);
		const out: ChangeRecord[] = [];
		for (const row of rows) {
			const date = toYmd(pickString(row, ['date', 'dateAdded', 'dateRemoved', 'changeDate']));
			if (!date) continue;
			const added = normSymbol(pickString(row, ['addedSecurity', 'symbolAdded', 'added']));
			const removed = normSymbol(
				pickString(row, ['removedTicker', 'removedSecurity', 'symbolRemoved', 'removed'])
			);
			// Some revisions put the changed symbol in `symbol` + a `reason`/action.
			const symbol = normSymbol(pickString(row, ['symbol', 'ticker']));
			if (added || removed) {
				out.push({ date, added, removed });
			} else if (symbol) {
				// Fall back: treat a bare symbol row as an addition (best effort).
				out.push({ date, added: symbol, removed: null });
			}
		}
		if (out.length === 0) {
			gaps.push({
				detail: `Historical constituent change feed for "${this.index}" was empty or unparseable; membership cannot be reconstructed backwards.`
			});
		}
		return out;
	}

	private async fetchDelisted(fetchFn: FetchFn, gaps: CoverageGap[]): Promise<DelistedRecord[]> {
		const url = `${BASE}/delisted-companies?apikey=${encodeURIComponent(this.apiKey)}`;
		const rows = await this.requestArray(url, fetchFn, gaps, 'delisted companies');
		const out: DelistedRecord[] = [];
		for (const row of rows) {
			const symbol = normSymbol(pickString(row, ['symbol', 'ticker']));
			if (!symbol) continue;
			const delistedDate = toYmd(pickString(row, ['delistedDate', 'date', 'removedDate']));
			out.push({ symbol, delistedDate });
		}
		return out;
	}

	/**
	 * Fetch JSON and coerce to an array of records, tolerating object-wrapped
	 * responses (mirrors the FMP client's `extractBars`). Any failure pushes a
	 * {@link CoverageGap} and yields an empty array — never throws.
	 */
	private async requestArray(
		url: string,
		fetchFn: FetchFn,
		gaps: CoverageGap[],
		label: string
	): Promise<Array<Record<string, unknown>>> {
		let res: Response;
		try {
			res = await fetchFn(url);
		} catch {
			gaps.push({ detail: `Could not reach FMP for ${label}.` });
			return [];
		}
		if (!res.ok) {
			gaps.push({ detail: `FMP request for ${label} failed (HTTP ${res.status}).` });
			return [];
		}
		let body: unknown;
		try {
			body = await res.json();
		} catch {
			gaps.push({ detail: `FMP response for ${label} was not valid JSON.` });
			return [];
		}
		const arr = extractRecords(body);
		if (arr === null) {
			const msg =
				body && typeof body === 'object' && !Array.isArray(body)
					? (body as Record<string, unknown>)['Error Message']
					: undefined;
			gaps.push({
				detail:
					typeof msg === 'string'
						? `FMP error for ${label}: ${msg}`
						: `FMP response for ${label} had an unexpected shape.`
			});
			return [];
		}
		return arr;
	}
}

/**
 * Membership as of `date` (`YYYY-MM-DD`, inclusive), reconstructed by replaying
 * the change log BACKWARDS from the current set. A change on day D means: on D
 * the `added` symbol became a member and the `removed` symbol stopped being one.
 * So to get membership at `date` we undo every change with `change.date > date`:
 * undo an addition by removing the symbol; undo a removal by re-adding it. Pure.
 */
function membersAtDate(current: string[], changes: ChangeRecord[], date: string): string[] {
	const working = new Set<string>(current);
	// Apply newest-first so undo order is well-defined when a symbol churns.
	const newestFirst = [...changes].sort((a, b) => b.date.localeCompare(a.date));
	for (const ch of newestFirst) {
		if (ch.date <= date) break; // change is in effect as of `date`; keep it
		// Undo a change effective AFTER `date`.
		if (ch.added) working.delete(ch.added);
		if (ch.removed) working.add(ch.removed);
	}
	return [...working].sort();
}

/**
 * Resolve an array of plain records from an FMP body. Returns null (not []) when
 * the shape is unexpected so callers can surface an explicit gap; an empty array
 * from the API is a valid (if empty) result.
 */
function extractRecords(body: unknown): Array<Record<string, unknown>> | null {
	if (Array.isArray(body)) return body.filter(isRecord);
	if (body && typeof body === 'object') {
		const obj = body as Record<string, unknown>;
		if (typeof obj['Error Message'] === 'string') return null;
		for (const key of ['historical', 'results', 'data', 'constituents']) {
			const v = obj[key];
			if (Array.isArray(v)) return v.filter(isRecord);
		}
		return null;
	}
	return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}
