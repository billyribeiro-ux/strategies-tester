import type { PageLoad } from './$types';
import { createApiClient, ApiError } from '$lib/api/client';
import type { Capabilities, SavedStrategy } from '$lib/types';

export interface BuilderData {
	capabilities: Capabilities | null;
	saved: SavedStrategy | null;
	error: string | null;
}

export const load: PageLoad = async ({ fetch, url }): Promise<BuilderData> => {
	const api = createApiClient(fetch);
	try {
		const capabilities = await api.getCapabilities();
		const id = url.searchParams.get('strategyId');
		const saved = id ? await api.getStrategy(id) : null;
		return { capabilities, saved, error: null };
	} catch (err) {
		const message =
			err instanceof ApiError ? err.message : 'Could not load the strategy builder.';
		return { capabilities: null, saved: null, error: message };
	}
};
