import { createApiClient } from '$lib/api/client';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const api = createApiClient(fetch);
	try {
		return { strategies: await api.listStrategies(), error: null };
	} catch {
		return {
			strategies: [],
			error: 'Could not load your strategies. Please try again.'
		};
	}
};
