import { createApiClient } from '$lib/api/client';
import type { SettingsStatus } from '$lib/api/client';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const api = createApiClient(fetch);
	try {
		return { status: await api.getSettings(), error: null };
	} catch {
		const status: SettingsStatus = { fmpKeySet: false, source: 'none' };
		return { status, error: 'Could not load settings. Please try again.' };
	}
};
