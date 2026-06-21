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
		const versionParam = url.searchParams.get('version');

		let saved: SavedStrategy | null = null;
		if (id) {
			const requestedVersion = versionParam ? Number(versionParam) : null;
			if (requestedVersion !== null && Number.isFinite(requestedVersion)) {
				// Open a specific historical version (from the Versions modal). Each
				// version row already carries its full spec; fall back to the current
				// strategy if the requested version no longer exists.
				const versions = await api.listVersions(id);
				saved = versions.find((v) => v.version === requestedVersion) ?? (await api.getStrategy(id));
			} else {
				saved = await api.getStrategy(id);
			}
		}
		return { capabilities, saved, error: null };
	} catch (err) {
		const message = err instanceof ApiError ? err.message : 'Could not load the strategy builder.';
		return { capabilities: null, saved: null, error: message };
	}
};
