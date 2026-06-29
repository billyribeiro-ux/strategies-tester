/**
 * POST /api/universe — resolve a point-in-time, survivorship-aware universe.
 *
 * This is the HTTP surface over the server-only universe providers
 * (`$lib/server/universe`). The client picks a provider and a date range; the
 * route builds the matching {@link UniverseProvider}, calls `resolve(from, to)`
 * and returns the membership snapshots plus any coverage gaps. The gaps are the
 * survivorship-free honesty surface — they document where the data is partial or
 * structurally biased rather than silently dropping names.
 *
 * Providers:
 *   'explicit' — a fixed, user-supplied symbol list (NOT survivorship-free).
 *   'fmpPit'   — best-effort PIT index membership from FMP (includes delisted
 *                names during the window). The FMP API key is resolved server-side
 *                and NEVER appears in the response.
 */

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { ExplicitListProvider } from '$lib/server/universe/explicit';
import { FmpPitProvider } from '$lib/server/universe/fmp-pit';
import type { UniverseProvider } from '$lib/server/universe/types';
import { FMP_KEY, getSetting } from '$lib/server/db/repository';

type ProviderKind = 'explicit' | 'fmpPit';

/**
 * Resolve the active FMP key exactly like the FMP client does: a UI-saved key
 * (DB) takes precedence over the env var. Server-only — never returned.
 */
function resolveFmpKey(): string | null {
	return getSetting(FMP_KEY) ?? env.FMP_API_KEY ?? null;
}

/** Validate a `YYYY-MM-DD`-ish date string. */
function isValidDate(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}
	if (!body || typeof body !== 'object') {
		throw error(400, { message: 'Expected { provider, from, to, symbols?, index? }.' });
	}

	const { provider, symbols, index, from, to } = body as {
		provider?: unknown;
		symbols?: unknown;
		index?: unknown;
		from?: unknown;
		to?: unknown;
	};

	if (provider !== 'explicit' && provider !== 'fmpPit') {
		throw error(400, { message: 'Provider must be "explicit" or "fmpPit".' });
	}
	const kind = provider as ProviderKind;

	// Validate the date range.
	if (!isValidDate(from) || !isValidDate(to)) {
		throw error(400, { message: 'Both "from" and "to" must be valid dates (YYYY-MM-DD).' });
	}
	if (from >= to) {
		throw error(400, { message: '"from" must be earlier than "to".' });
	}

	let universe: UniverseProvider;

	if (kind === 'explicit') {
		const list = Array.isArray(symbols)
			? symbols.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
			: [];
		if (list.length === 0) {
			throw error(400, { message: 'Provide at least one symbol for the explicit provider.' });
		}
		universe = new ExplicitListProvider(list);
	} else {
		const apiKey = resolveFmpKey();
		if (!apiKey) {
			throw error(502, {
				message: 'No FMP API key is configured. Add it in Settings (or set FMP_API_KEY).'
			});
		}
		const idx = typeof index === 'string' && index.trim() ? index.trim() : 'sp500';
		universe = new FmpPitProvider({ apiKey, index: idx });
	}

	// Providers are best-effort: coverage problems come back as `gaps`, not throws.
	const { membership, gaps } = await universe.resolve(from, to, fetch);

	return json({ providerId: universe.id, membership, gaps });
};
