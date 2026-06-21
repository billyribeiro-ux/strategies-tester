/**
 * Typed API client — the single seam between the UI and the backend.
 *
 * Every call accepts an optional `fetch` so it works inside SvelteKit `load`
 * functions (server + client) and the store. There is NO indicator or P&L math
 * here — results come from the backend, the single source of truth.
 */

import type {
	BacktestResult,
	Candle,
	Capabilities,
	SavedStrategy,
	StrategySpec
} from '$lib/types';

export type FetchFn = typeof fetch;

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public details?: unknown
	) {
		super(message);
		this.name = 'ApiError';
	}
}

async function request<T>(
	fetchFn: FetchFn,
	method: string,
	url: string,
	body?: unknown
): Promise<T> {
	let res: Response;
	try {
		res = await fetchFn(url, {
			method,
			headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
			body: body !== undefined ? JSON.stringify(body) : undefined
		});
	} catch (cause) {
		throw new ApiError(0, 'Network error — could not reach the server.', cause);
	}

	const isJson = res.headers.get('content-type')?.includes('application/json');
	const payload = isJson ? await res.json().catch(() => undefined) : await res.text().catch(() => undefined);

	if (!res.ok) {
		const message =
			(payload && typeof payload === 'object' && 'message' in payload
				? String((payload as { message: unknown }).message)
				: undefined) ?? `Request failed (${res.status})`;
		throw new ApiError(res.status, message, payload);
	}
	return payload as T;
}

const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();

// ---------------------------------------------------------------------------
// Payload DTOs
// ---------------------------------------------------------------------------

export interface CreateStrategyInput {
	name: string;
	spec: StrategySpec;
}
export interface UpdateStrategyInput {
	name?: string;
	spec: StrategySpec;
	/** Create a new version snapshot on save (default true). */
	bumpVersion?: boolean;
}
export interface CandleQuery {
	symbol: string;
	timeframe: string;
	from: string;
	to: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function createApiClient(fetchFn: FetchFn = fetch) {
	return {
		getCapabilities: () => request<Capabilities>(fetchFn, 'GET', '/api/capabilities'),

		runBacktest: (spec: StrategySpec) =>
			request<BacktestResult>(fetchFn, 'POST', '/api/backtest', spec),

		getResult: (runId: string) =>
			request<BacktestResult>(fetchFn, 'GET', `/api/runs/${encodeURIComponent(runId)}`),

		getCandles: (query: CandleQuery) =>
			request<Candle[]>(
				fetchFn,
				'GET',
				`/api/candles?${qs({
					symbol: query.symbol,
					timeframe: query.timeframe,
					from: query.from,
					to: query.to
				})}`
			),

		listStrategies: () => request<SavedStrategy[]>(fetchFn, 'GET', '/api/strategies'),

		getStrategy: (id: string) =>
			request<SavedStrategy>(fetchFn, 'GET', `/api/strategies/${encodeURIComponent(id)}`),

		createStrategy: (input: CreateStrategyInput) =>
			request<SavedStrategy>(fetchFn, 'POST', '/api/strategies', input),

		updateStrategy: (id: string, input: UpdateStrategyInput) =>
			request<SavedStrategy>(fetchFn, 'PUT', `/api/strategies/${encodeURIComponent(id)}`, input),

		deleteStrategy: (id: string) =>
			request<{ ok: true }>(fetchFn, 'DELETE', `/api/strategies/${encodeURIComponent(id)}`),

		duplicateStrategy: (id: string) =>
			request<SavedStrategy>(
				fetchFn,
				'POST',
				`/api/strategies/${encodeURIComponent(id)}/duplicate`
			),

		listVersions: (id: string) =>
			request<SavedStrategy[]>(
				fetchFn,
				'GET',
				`/api/strategies/${encodeURIComponent(id)}/versions`
			)
	};
}

export type ApiClient = ReturnType<typeof createApiClient>;
