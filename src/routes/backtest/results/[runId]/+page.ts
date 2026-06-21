import { createApiClient, ApiError } from '$lib/api/client';
import type { BacktestResult } from '$lib/types';
import type { PageLoad } from './$types';

export interface LoadError {
	status: number;
	message: string;
}

export interface ResultsPageData {
	result: BacktestResult | null;
	loadError: LoadError | null;
}

/**
 * Load the run result. Errors are returned as data (not thrown) so the page can
 * render the in-app ErrorState with a retry, rather than the framework error
 * boundary — keeping 404/empty/error handling inside the results layout.
 */
export const load: PageLoad = async ({ params, fetch }): Promise<ResultsPageData> => {
	const api = createApiClient(fetch);
	try {
		const result = await api.getResult(params.runId);
		return { result, loadError: null };
	} catch (e) {
		if (e instanceof ApiError) {
			const message =
				e.status === 404
					? `No backtest run found for id “${params.runId}”.`
					: e.status === 0
						? 'Could not reach the server. Check your connection and try again.'
						: e.message;
			return { result: null, loadError: { status: e.status, message } };
		}
		return {
			result: null,
			loadError: { status: 500, message: 'An unexpected error occurred while loading the result.' }
		};
	}
};
