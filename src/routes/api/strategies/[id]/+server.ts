/** GET / PUT / DELETE /api/strategies/[id]. */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseSpec } from '$lib/validation';
import {
	deleteStrategy,
	getStrategy,
	updateStrategy
} from '$lib/server/db/repository';

export const GET: RequestHandler = ({ params }) => {
	const strategy = getStrategy(params.id);
	if (!strategy) throw error(404, { message: `Strategy "${params.id}" was not found.` });
	return json(strategy);
};

export const PUT: RequestHandler = async ({ params, request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Request body must be valid JSON.' });
	}
	if (!body || typeof body !== 'object') {
		throw error(400, { message: 'Expected { name?, spec, bumpVersion? }.' });
	}
	const { name, spec, bumpVersion } = body as {
		name?: unknown;
		spec?: unknown;
		bumpVersion?: unknown;
	};

	if (name !== undefined && typeof name !== 'string') {
		throw error(400, { message: '"name" must be a string.' });
	}
	const parsed = parseSpec(spec);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		const where = first?.path?.length ? ` at ${first.path.join('.')}` : '';
		throw error(400, { message: `Invalid spec${where}: ${first?.message ?? 'unknown error'}` });
	}

	const updated = updateStrategy(params.id, {
		name: name as string | undefined,
		spec: parsed.data,
		bumpVersion: typeof bumpVersion === 'boolean' ? bumpVersion : undefined
	});
	if (!updated) throw error(404, { message: `Strategy "${params.id}" was not found.` });
	return json(updated);
};

export const DELETE: RequestHandler = ({ params }) => {
	const ok = deleteStrategy(params.id);
	if (!ok) throw error(404, { message: `Strategy "${params.id}" was not found.` });
	return json({ ok: true });
};
