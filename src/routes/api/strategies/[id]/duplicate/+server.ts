/** POST /api/strategies/[id]/duplicate — copy a strategy as "<name> (copy)". */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duplicateStrategy } from '$lib/server/db/repository';

export const POST: RequestHandler = ({ params }) => {
	const copy = duplicateStrategy(params.id);
	if (!copy) throw error(404, { message: `Strategy "${params.id}" was not found.` });
	return json(copy, { status: 201 });
};
