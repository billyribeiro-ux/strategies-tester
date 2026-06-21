/** GET /api/strategies — list. POST /api/strategies — create. */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseSpec } from '$lib/validation';
import { createStrategy, listStrategies } from '$lib/server/db/repository';

export const GET: RequestHandler = () => {
	return json(listStrategies());
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}

	if (!body || typeof body !== 'object') {
		throw error(400, { message: 'Expected { name, spec }.' });
	}
	const { name, spec } = body as { name?: unknown; spec?: unknown };
	if (typeof name !== 'string' || !name.trim()) {
		throw error(400, { message: 'A non-empty "name" is required.' });
	}

	const parsed = parseSpec(spec);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		const where = first?.path?.length ? ` at ${first.path.join('.')}` : '';
		throw error(400, { message: `Invalid spec${where}: ${first?.message ?? 'unknown error'}` });
	}

	const saved = createStrategy({ name: name.trim(), spec: parsed.data });
	return json(saved, { status: 201 });
};
