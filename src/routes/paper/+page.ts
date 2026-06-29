import { createApiClient } from '$lib/api/client';
import type { SavedStrategy } from '$lib/types';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	const api = createApiClient(fetch);
	try {
		const strategies = await api.listStrategies();
		const id = url.searchParams.get('strategyId');
		const selected = id ? (strategies.find((s) => s.id === id) ?? null) : null;
		return { strategies, selected, error: null };
	} catch {
		return {
			strategies: [] as SavedStrategy[],
			selected: null as SavedStrategy | null,
			error: 'Could not load your strategies. Please try again.'
		};
	}
};
