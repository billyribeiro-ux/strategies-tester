import { createApiClient } from '$lib/api/client';
import type { Capabilities, SavedStrategy } from '$lib/types';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	const api = createApiClient(fetch);
	try {
		const [capabilities, strategies] = await Promise.all([
			api.getCapabilities(),
			api.listStrategies()
		]);
		const id = url.searchParams.get('strategyId');
		const selected = id ? (strategies.find((s) => s.id === id) ?? null) : null;
		return { capabilities, strategies, selected, error: null };
	} catch {
		return {
			capabilities: null as Capabilities | null,
			strategies: [] as SavedStrategy[],
			selected: null as SavedStrategy | null,
			error: 'Could not load strategies. Please try again.'
		};
	}
};
