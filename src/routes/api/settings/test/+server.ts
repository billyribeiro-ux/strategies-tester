/** POST /api/settings/test — validate the active FMP key against the provider. */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyFmpKey } from '$lib/server/fmp/client';

export const POST: RequestHandler = async () => json(await verifyFmpKey());
