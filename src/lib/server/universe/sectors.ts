/**
 * Sector-classification data layer — the building block a later
 * sector-exposure-limit feature will consume.
 *
 * `fetchSectors` resolves a symbol -> sector map from FMP's company profile
 * feed; `groupBySector`, `sectorExposure` are pure transforms over that map.
 *
 * POINT-IN-TIME CAVEAT (read this before trusting historical buckets)
 * ------------------------------------------------------------------
 * FMP's company profile returns the CURRENT sector for a symbol, NOT a
 * point-in-time classification. There is no historical sector feed, so this is a
 * BEST-EFFORT APPROXIMATION: a name that was reclassified (e.g. a GICS sector
 * change) or has since been delisted/acquired may be mis-bucketed when applied to
 * a historical backtest window. Unlike `fmp-pit.ts` (which reconstructs PIT index
 * membership), sector labels here are assumed stable over the backtest. Treat the
 * resulting exposure numbers as approximate for long-dated or heavily-churned
 * universes.
 *
 * ENDPOINT ASSUMPTION
 * -------------------
 *   GET {BASE}/profile?symbol=SYM&apikey=...
 *       -> array (usually length 1) of company-profile records, each carrying a
 *          `sector` string field. We query PER SYMBOL (one request each) rather
 *          than batching: the `/stable/profile` endpoint is documented as a
 *          single-symbol lookup, and per-symbol requests keep coverage-gap
 *          attribution exact (we know precisely which symbol failed). Responses
 *          are parsed defensively to tolerate a bare array, an object-wrapped
 *          array, a single object, or a missing/blank `sector`.
 *
 * Like the rest of the universe layer: ALL network access goes through the
 * injected `fetchFn` so this is fully unit-testable with a canned stub, and EVERY
 * unresolved symbol becomes a {@link CoverageGap} (mapped to {@link UNKNOWN_SECTOR})
 * rather than a thrown error.
 */

import type { CoverageGap, FetchFn } from './types';

const BASE = 'https://financialmodelingprep.com/stable';

/** Sentinel sector for symbols whose sector could not be resolved. */
export const UNKNOWN_SECTOR = 'Unknown';

/** Map of symbol -> sector label (e.g. `'Technology'`). */
export interface SectorMap {
	[symbol: string]: string;
}

/** Pull the first present non-blank string field from a record, trimmed; else null. */
function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
	for (const k of keys) {
		const v = obj[k];
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return null;
}

function normSymbol(value: string): string {
	return value.trim().toUpperCase();
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Resolve an array of plain records from an FMP profile body, tolerating a bare
 * array, an object-wrapped array (`results`/`data`/`profile`), or a single
 * object. Returns null (not []) when the shape is unexpected or carries an
 * explicit error, so the caller can surface a precise gap.
 */
function extractRecords(body: unknown): Array<Record<string, unknown>> | null {
	if (Array.isArray(body)) return body.filter(isRecord);
	if (isRecord(body)) {
		if (typeof body['Error Message'] === 'string') return null;
		for (const key of ['results', 'data', 'profile']) {
			const v = body[key];
			if (Array.isArray(v)) return v.filter(isRecord);
		}
		// A single profile object (not wrapped in an array) is still a valid 1-row result.
		return [body];
	}
	return null;
}

/**
 * Fetch one symbol's profile and extract its `sector`. Never throws: any
 * failure (network, HTTP error, bad JSON, unexpected shape, missing sector)
 * pushes a {@link CoverageGap} and returns null so the caller maps the symbol to
 * {@link UNKNOWN_SECTOR}.
 */
async function fetchSector(
	symbol: string,
	apiKey: string,
	fetchFn: FetchFn,
	gaps: CoverageGap[]
): Promise<string | null> {
	const url = `${BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

	let res: Response;
	try {
		res = await fetchFn(url);
	} catch {
		gaps.push({ detail: `Could not reach FMP for ${symbol} profile.` });
		return null;
	}
	if (!res.ok) {
		gaps.push({ detail: `FMP profile request for ${symbol} failed (HTTP ${res.status}).` });
		return null;
	}
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		gaps.push({ detail: `FMP profile response for ${symbol} was not valid JSON.` });
		return null;
	}

	const rows = extractRecords(body);
	if (rows === null) {
		const msg = isRecord(body) ? body['Error Message'] : undefined;
		gaps.push({
			detail:
				typeof msg === 'string'
					? `FMP error for ${symbol} profile: ${msg}`
					: `FMP profile response for ${symbol} had an unexpected shape.`
		});
		return null;
	}

	for (const row of rows) {
		const sector = pickString(row, ['sector', 'Sector']);
		if (sector) return sector;
	}
	gaps.push({ detail: `No sector found for ${symbol}; bucketed as "${UNKNOWN_SECTOR}".` });
	return null;
}

/**
 * Resolve a symbol -> sector map for `symbols` from FMP company profiles.
 *
 * One request per symbol (see endpoint assumption above). Symbols are normalized
 * (trimmed/upper-cased) and de-duplicated, so the returned map is keyed by the
 * normalized symbol. Any symbol whose sector cannot be resolved is mapped to
 * {@link UNKNOWN_SECTOR} and recorded as a {@link CoverageGap}. Never throws.
 *
 * Best-effort and order-independent: the resulting `sectors` map and `gaps`
 * depend only on the input set and the stub responses, not on Date/Math.random.
 */
export async function fetchSectors(
	symbols: string[],
	apiKey: string,
	fetchFn: FetchFn = fetch
): Promise<{ sectors: SectorMap; gaps: CoverageGap[] }> {
	const gaps: CoverageGap[] = [];
	const sectors: SectorMap = {};

	// Normalize + de-duplicate while preserving deterministic (sorted) processing.
	const unique = [...new Set(symbols.map(normSymbol).filter((s) => s.length > 0))].sort();

	for (const symbol of unique) {
		const sector = await fetchSector(symbol, apiKey, fetchFn, gaps);
		sectors[symbol] = sector ?? UNKNOWN_SECTOR;
	}

	return { sectors, gaps };
}

/**
 * Pure inversion of a {@link SectorMap}: sector -> the symbols in it. Both the
 * sectors (object keys) and each symbol list are sorted so the output is fully
 * deterministic regardless of input ordering.
 */
export function groupBySector(sectors: SectorMap): Record<string, string[]> {
	const grouped: Record<string, string[]> = {};
	for (const symbol of Object.keys(sectors)) {
		const sector = sectors[symbol];
		(grouped[sector] ??= []).push(symbol);
	}

	const out: Record<string, string[]> = {};
	for (const sector of Object.keys(grouped).sort()) {
		out[sector] = [...grouped[sector]].sort();
	}
	return out;
}

/**
 * Pure: count how many of `openSymbols` fall in each sector — the building block
 * for a sector-exposure cap. A symbol absent from `sectors` is counted under
 * {@link UNKNOWN_SECTOR}. Input symbols are normalized so casing/whitespace does
 * not split a bucket. Output keys are sorted for deterministic iteration.
 */
export function sectorExposure(openSymbols: string[], sectors: SectorMap): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const raw of openSymbols) {
		const symbol = normSymbol(raw);
		if (!symbol) continue;
		const sector = sectors[symbol] ?? UNKNOWN_SECTOR;
		counts[sector] = (counts[sector] ?? 0) + 1;
	}

	const out: Record<string, number> = {};
	for (const sector of Object.keys(counts).sort()) {
		out[sector] = counts[sector];
	}
	return out;
}
