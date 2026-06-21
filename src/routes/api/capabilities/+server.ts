/** GET /api/capabilities — the schema-driven indicator/operator catalog. */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CAPABILITIES } from '$lib/capabilities/catalog';

export const GET: RequestHandler = () => {
	return json(CAPABILITIES);
};
