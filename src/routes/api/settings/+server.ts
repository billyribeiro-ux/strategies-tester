/**
 * Settings API. The FMP key is write-only from the client's perspective: it can
 * be saved or cleared, but GET only ever returns whether a key is set (and its
 * source) — never the key value itself.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FMP_KEY, deleteSetting, setSetting } from '$lib/server/db/repository';
import { fmpKeyStatus } from '$lib/server/fmp/client';

export const GET: RequestHandler = () => json(fmpKeyStatus());

export const PUT: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}
	if (!body || typeof body !== 'object') {
		throw error(400, { message: 'Expected { fmpKey }.' });
	}
	const { fmpKey } = body as { fmpKey?: unknown };
	if (typeof fmpKey !== 'string' || !fmpKey.trim()) {
		throw error(400, { message: 'A non-empty "fmpKey" is required.' });
	}
	setSetting(FMP_KEY, fmpKey.trim());
	return json(fmpKeyStatus());
};

export const DELETE: RequestHandler = () => {
	deleteSetting(FMP_KEY);
	return json({ ok: true });
};
