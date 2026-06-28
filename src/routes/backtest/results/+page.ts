import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/backtest/results` (and `/backtest/results/`) has nothing to show without a
 * run id — results live at `/backtest/results/[runId]`. Rather than 404, send
 * visitors to the builder. The redirect fires in `load`, so the sibling
 * `+page.svelte` is only ever a no-JS fallback.
 */
export const load: PageLoad = () => {
	redirect(307, '/backtest');
};
