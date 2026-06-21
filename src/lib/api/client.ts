/**
 * Typed API client — the single seam between the UI and the backend.
 *
 * Every call accepts an optional `fetch` so it works inside SvelteKit `load`
 * functions (server + client) and the store. There is NO indicator or P&L math
 * here — results come from the backend, the single source of truth.
 */

import type { BacktestResult, Candle, Capabilities, SavedStrategy, StrategySpec } from '$lib/types';

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

	// Read the body as text and try to parse JSON. We deliberately avoid reading
	// the `content-type` response header: during SSR, SvelteKit restricts which
	// internal-fetch headers a `load` may read and throws on others.
	const text = await res.text().catch(() => '');
	let payload: unknown = text.length ? text : undefined;
	if (text.length) {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = text;
		}
	}

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
export interface SettingsStatus {
	/** Whether an FMP key is available (via Settings or env). Never the key itself. */
	fmpKeySet: boolean;
	source: 'db' | 'env' | 'none';
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
			),

		getSettings: () => request<SettingsStatus>(fetchFn, 'GET', '/api/settings'),

		saveSettings: (fmpKey: string) =>
			request<SettingsStatus>(fetchFn, 'PUT', '/api/settings', { fmpKey }),

		clearSettings: () => request<{ ok: true }>(fetchFn, 'DELETE', '/api/settings'),

		testFmpKey: () =>
			request<{ ok: boolean; message: string }>(fetchFn, 'POST', '/api/settings/test')
	};
}

export type ApiClient = ReturnType<typeof createApiClient>;
