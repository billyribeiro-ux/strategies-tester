/** GET /api/runs/[runId] — fetch a persisted BacktestResult. */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRun } from '$lib/server/db/repository';

export const GET: RequestHandler = ({ params }) => {
	const result = getRun(params.runId);
	if (!result) throw error(404, { message: `Run "${params.runId}" was not found.` });
	return json(result);
};
