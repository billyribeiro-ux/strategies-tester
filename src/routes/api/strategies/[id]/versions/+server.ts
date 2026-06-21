/** GET /api/strategies/[id]/versions — version history, newest first. */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStrategy, listVersions } from '$lib/server/db/repository';

export const GET: RequestHandler = ({ params }) => {
	const strategy = getStrategy(params.id);
	if (!strategy) throw error(404, { message: `Strategy "${params.id}" was not found.` });
	return json(listVersions(params.id));
};
