/**
 * Client-side cache of freshly-computed backtest results, keyed by `runId`.
 *
 * When the builder runs a strategy it POSTs the spec to `/api/backtest` and gets
 * the FULL `BacktestResult` back in hand. Rather than discard it and have the
 * results page re-fetch the same (potentially large) payload via
 * `GET /api/runs/:id` — a second round-trip that 404s if the run was evicted
 * from the ephemeral `local.db` between the POST and the GET — we stash the
 * result here on the way to the results page. The results `load` reads it on
 * arrival and renders instantly, with no network call and no 404 window.
 *
 * BROWSER-ONLY by contract. The only writer is `StrategyStore.run()`, which runs
 * exclusively in response to a user click, so this module-scoped map is never
 * written on the server. The results `load` reads it solely behind an
 * `if (browser)` guard, so it is never read during SSR either — which is what
 * makes shared module state safe here (see SvelteKit "Avoid shared state on the
 * server"). Deep-links and reloads miss the cache and fall back to the fetch.
 */

import type { BacktestResult } from '$lib/types';

/** Most-recent runs to retain. Bounded so a long session can't leak memory. */
const MAX_ENTRIES = 8;

/** Insertion-ordered; oldest key is evicted first once the cap is exceeded. */
const cache = new Map<string, BacktestResult>();

/** Stash a just-computed result so the results page can render without a refetch. */
export function rememberRun(result: BacktestResult): void {
	if (!result || typeof result.runId !== 'string' || result.runId.length === 0) return;
	// Re-insert to mark as most-recent (Map preserves insertion order).
	cache.delete(result.runId);
	cache.set(result.runId, result);
	while (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

/** Look up a cached result without consuming it (so reload-in-place stays instant). */
export function peekRun(runId: string): BacktestResult | null {
	return cache.get(runId) ?? null;
}

/** Test/diagnostic helper — drop every cached entry. */
export function clearRunCache(): void {
	cache.clear();
}
