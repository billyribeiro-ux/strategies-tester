/**
 * Financial Modeling Prep (FMP) market-data client.
 *
 * `fetchCandles` returns normalized, ascending `Candle[]` for a symbol/timeframe/
 * date range. It is cache-first: a hit in `candle_cache` (keyed by
 * symbol+timeframe+from+to) is returned without touching the network. On a miss
 * it calls the appropriate FMP `/stable/` endpoint, normalizes, optionally
 * aggregates (weekly) and session-filters (intraday), persists the result, and
 * returns it.
 *
 * Server-only: imports the private env and the DB. Never bundled to the client.
 */

import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import type { Candle, SessionSpec } from '$lib/types';
import { db } from '../db';
import { candleCache } from '../db/schema';
import { createId } from '$lib/utils/id';

export type FetchFn = typeof fetch;

export interface CandleQuery {
	symbol: string;
	timeframe: string;
	from: string;
	to: string;
	/** Session filter; defaults to RTH for intraday, ETH (all) for daily+. */
	session?: SessionSpec;
}

/** Raw FMP bar shape (both EOD and intraday endpoints share this shape). */
interface FmpBar {
	date?: string;
	open?: number;
	high?: number;
	low?: number;
	close?: number;
	volume?: number;
}

const INTRADAY_INTERVAL: Record<string, string> = {
	'1m': '1min',
	'5m': '5min',
	'15m': '15min',
	'30m': '30min',
	'1h': '1hour',
	'4h': '4hour'
};

const BASE = 'https://financialmodelingprep.com/stable';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchCandles(
	query: CandleQuery,
	fetchFn: FetchFn = fetch
): Promise<Candle[]> {
	const { symbol, timeframe, from, to } = query;

	const cached = readCache(symbol, timeframe, from, to);
	if (cached) return cached;

	const apiKey = env.FMP_API_KEY;
	if (!apiKey) {
		throw new Error('FMP_API_KEY is not configured on the server.');
	}

	let candles: Candle[];
	if (timeframe === '1d') {
		candles = normalizeBars(await fetchDailyRange(symbol, from, to, apiKey, fetchFn));
	} else if (timeframe === '1w') {
		const daily = normalizeBars(await fetchDailyRange(symbol, from, to, apiKey, fetchFn));
		candles = aggregateWeekly(daily);
	} else if (INTRADAY_INTERVAL[timeframe]) {
		const interval = INTRADAY_INTERVAL[timeframe];
		const raw = normalizeBars(await fetchIntraday(symbol, interval, from, to, apiKey, fetchFn));
		candles = filterSession(raw, query.session ?? { kind: 'RTH' });
	} else {
		throw new Error(`Unsupported timeframe "${timeframe}".`);
	}

	candles.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
	writeCache(symbol, timeframe, from, to, candles);
	return candles;
}

// ---------------------------------------------------------------------------
// FMP endpoint calls
// ---------------------------------------------------------------------------

async function fetchDaily(
	symbol: string,
	from: string,
	to: string,
	apiKey: string,
	fetchFn: FetchFn
): Promise<FmpBar[]> {
	const url = `${BASE}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${encodeURIComponent(apiKey)}`;
	return requestArray(url, symbol, fetchFn);
}

/**
 * Daily fetch that respects FMP's documented 5-year-per-request window: ranges
 * longer than that are split into adjacent ≤5-year sub-requests and concatenated
 * (boundary days are de-duplicated downstream in `normalizeBars`). Without this a
 * 10-year backtest would silently receive only the most recent 5 years.
 */
async function fetchDailyRange(
	symbol: string,
	from: string,
	to: string,
	apiKey: string,
	fetchFn: FetchFn
): Promise<FmpBar[]> {
	const windows = splitDateRange(from, to, MAX_RANGE_YEARS);
	if (windows.length <= 1) return fetchDaily(symbol, from, to, apiKey, fetchFn);
	const all: FmpBar[] = [];
	for (const w of windows) {
		all.push(...(await fetchDaily(symbol, w.from, w.to, apiKey, fetchFn)));
	}
	return all;
}

const MAX_RANGE_YEARS = 5;

/** Split an inclusive `YYYY-MM-DD` range into adjacent windows of ≤ `maxYears`. */
function splitDateRange(
	from: string,
	to: string,
	maxYears: number
): Array<{ from: string; to: string }> {
	const start = Date.parse(`${from}T00:00:00Z`);
	const end = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return [{ from, to }];
	const DAY = 86_400_000;
	const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
	const windows: Array<{ from: string; to: string }> = [];
	let s = start;
	while (s <= end) {
		const sd = new Date(s);
		const capped =
			Date.UTC(sd.getUTCFullYear() + maxYears, sd.getUTCMonth(), sd.getUTCDate()) - DAY;
		const e = Math.min(capped, end);
		windows.push({ from: ymd(s), to: ymd(e) });
		s = e + DAY;
	}
	return windows;
}

async function fetchIntraday(
	symbol: string,
	interval: string,
	from: string,
	to: string,
	apiKey: string,
	fetchFn: FetchFn
): Promise<FmpBar[]> {
	const url = `${BASE}/historical-chart/${interval}?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${encodeURIComponent(apiKey)}`;
	return requestArray(url, symbol, fetchFn);
}

/** Fetch JSON and coerce to a bar array, tolerating object-wrapped responses. */
async function requestArray(url: string, symbol: string, fetchFn: FetchFn): Promise<FmpBar[]> {
	let res: Response;
	try {
		res = await fetchFn(url);
	} catch (cause) {
		throw new Error(`Failed to reach market-data provider for ${symbol}.`, { cause });
	}
	if (!res.ok) {
		throw new Error(`Market-data request for ${symbol} failed (HTTP ${res.status}).`);
	}
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new Error(`Market-data response for ${symbol} was not valid JSON.`);
	}
	return extractBars(body);
}

/**
 * FMP sometimes returns a bare array and sometimes an object with a
 * `historical` (or similar) array property. Resolve both robustly.
 */
function extractBars(body: unknown): FmpBar[] {
	if (Array.isArray(body)) return body as FmpBar[];
	if (body && typeof body === 'object') {
		const obj = body as Record<string, unknown>;
		// Surface explicit API errors.
		if (typeof obj['Error Message'] === 'string') {
			throw new Error(String(obj['Error Message']));
		}
		for (const key of ['historical', 'results', 'data', 'historicalStockList']) {
			const v = obj[key];
			if (Array.isArray(v)) return v as FmpBar[];
		}
	}
	return [];
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeBars(bars: FmpBar[]): Candle[] {
	const out: Candle[] = [];
	for (const b of bars) {
		if (!b.date) continue;
		const o = num(b.open);
		const h = num(b.high);
		const l = num(b.low);
		const c = num(b.close);
		const v = num(b.volume);
		if ([o, h, l, c].some((x) => Number.isNaN(x))) continue;
		out.push({ t: toIso(b.date), o, h, l, c, v: Number.isNaN(v) ? 0 : v });
	}
	out.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
	// De-duplicate by timestamp (chunked daily fetches can repeat a boundary day),
	// keeping the last occurrence.
	const deduped: Candle[] = [];
	for (const c of out) {
		const last = deduped[deduped.length - 1];
		if (last && last.t === c.t) deduped[deduped.length - 1] = c;
		else deduped.push(c);
	}
	return deduped;
}

function num(v: unknown): number {
	if (typeof v === 'number') return v;
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : NaN;
	}
	return NaN;
}

/**
 * Convert an FMP date string to an ISO timestamp. Daily endpoints return
 * `YYYY-MM-DD`; intraday returns `YYYY-MM-DD HH:mm:ss` in ET. We treat the
 * intraday wall-clock as America/New_York and emit a proper UTC ISO instant so
 * downstream session filtering and grouping are unambiguous.
 */
function toIso(date: string): string {
	const trimmed = date.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		// Date-only → anchor at UTC midnight.
		return `${trimmed}T00:00:00.000Z`;
	}
	const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
	if (m) {
		const [, y, mo, d, h, mi, s] = m;
		const ms = etWallClockToUtcMs(
			Number(y),
			Number(mo),
			Number(d),
			Number(h),
			Number(mi),
			Number(s ?? '0')
		);
		return new Date(ms).toISOString();
	}
	// Fallback: let Date parse it.
	const parsed = Date.parse(trimmed);
	return Number.isNaN(parsed) ? new Date(0).toISOString() : new Date(parsed).toISOString();
}

// ---------------------------------------------------------------------------
// America/New_York timezone math (DST-aware, no external deps)
// ---------------------------------------------------------------------------

/** Offset (minutes) of America/New_York from UTC at a given UTC instant. */
function etOffsetMinutes(utcMs: number): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
	const parts = dtf.formatToParts(new Date(utcMs));
	const map: Record<string, number> = {};
	for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value);
	let hour = map.hour;
	if (hour === 24) hour = 0;
	const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
	return Math.round((asUtc - utcMs) / 60_000);
}

/** Convert an ET wall-clock date/time to the corresponding UTC milliseconds. */
function etWallClockToUtcMs(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number
): number {
	// Treat the wall-clock as if UTC, then correct by the ET offset (iterate
	// once to settle DST boundaries).
	const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
	let offset = etOffsetMinutes(naiveUtc);
	let utc = naiveUtc - offset * 60_000;
	const offset2 = etOffsetMinutes(utc);
	if (offset2 !== offset) {
		offset = offset2;
		utc = naiveUtc - offset * 60_000;
	}
	return utc;
}

/** ET wall-clock fields for a UTC instant, used by session filtering. */
function etFields(utcMs: number): { hour: number; minute: number } {
	const offset = etOffsetMinutes(utcMs);
	const local = new Date(utcMs + offset * 60_000);
	return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/** Same idea for an arbitrary IANA tz (custom sessions). */
function tzFields(utcMs: number, tz: string): { hour: number; minute: number } {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	const parts = dtf.formatToParts(new Date(utcMs));
	const map: Record<string, number> = {};
	for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value);
	let hour = map.hour;
	if (hour === 24) hour = 0;
	return { hour, minute: map.minute };
}

// ---------------------------------------------------------------------------
// Session filtering
// ---------------------------------------------------------------------------

const RTH_START = 9 * 60 + 30; // 09:30 ET
const RTH_END = 16 * 60; // 16:00 ET

function filterSession(candles: Candle[], session: SessionSpec): Candle[] {
	switch (session.kind) {
		case 'ETH':
			return candles;
		case 'RTH':
			return candles.filter((c) => {
				const { hour, minute } = etFields(Date.parse(c.t));
				const minutes = hour * 60 + minute;
				return minutes >= RTH_START && minutes < RTH_END;
			});
		case 'custom': {
			const start = hmToMinutes(session.startHM);
			const end = hmToMinutes(session.endHM);
			return candles.filter((c) => {
				const { hour, minute } = tzFields(Date.parse(c.t), session.tz);
				const minutes = hour * 60 + minute;
				return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end; // overnight session
			});
		}
	}
}

function hmToMinutes(hm: string): number {
	const [h, m] = hm.split(':').map(Number);
	return (h || 0) * 60 + (m || 0);
}

// ---------------------------------------------------------------------------
// Weekly aggregation
// ---------------------------------------------------------------------------

/** Aggregate ascending daily candles into ISO-week (Mon-anchored) bars. */
function aggregateWeekly(daily: Candle[]): Candle[] {
	const out: Candle[] = [];
	let bucketKey = '';
	let cur: Candle | null = null;
	for (const c of daily) {
		const key = isoWeekKey(c.t);
		if (key !== bucketKey) {
			if (cur) out.push(cur);
			bucketKey = key;
			cur = { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
		} else if (cur) {
			cur.h = Math.max(cur.h, c.h);
			cur.l = Math.min(cur.l, c.l);
			cur.c = c.c;
			cur.v += c.v;
		}
	}
	if (cur) out.push(cur);
	return out;
}

/** ISO year-week key so calendar weeks bucket correctly across year ends. */
function isoWeekKey(iso: string): string {
	const d = new Date(iso);
	const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
	date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
	const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	const week =
		1 +
		Math.round(
			((date.getTime() - firstThursday.getTime()) / 86_400_000 -
				3 +
				((firstThursday.getUTCDay() + 6) % 7)) /
				7
		);
	return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Cache (drizzle / better-sqlite3 — synchronous)
// ---------------------------------------------------------------------------

function readCache(symbol: string, timeframe: string, from: string, to: string): Candle[] | null {
	const rows = db
		.select()
		.from(candleCache)
		.where(
			and(
				eq(candleCache.symbol, symbol),
				eq(candleCache.timeframe, timeframe),
				eq(candleCache.fromDate, from),
				eq(candleCache.toDate, to)
			)
		)
		.limit(1)
		.all();
	if (rows.length === 0) return null;
	try {
		const parsed = JSON.parse(rows[0].data) as Candle[];
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function writeCache(
	symbol: string,
	timeframe: string,
	from: string,
	to: string,
	candles: Candle[]
) {
	db.insert(candleCache)
		.values({
			id: createId('cdl'),
			symbol,
			timeframe,
			fromDate: from,
			toDate: to,
			data: JSON.stringify(candles)
		})
		.onConflictDoUpdate({
			target: [candleCache.symbol, candleCache.timeframe, candleCache.fromDate, candleCache.toDate],
			set: { data: JSON.stringify(candles), fetchedAt: new Date().toISOString() }
		})
		.run();
}
