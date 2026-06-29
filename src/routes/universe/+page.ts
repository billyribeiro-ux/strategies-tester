import type { PageLoad } from './$types';

/**
 * The Universe Explorer resolves on demand (button click) via a direct POST to
 * /api/universe, so there is nothing to fetch up front. We only seed sensible
 * default form values (a recent 5-year window) so the page is usable immediately.
 */
export const load: PageLoad = () => {
	const today = new Date();
	const to = today.toISOString().slice(0, 10);
	const from = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate())
		.toISOString()
		.slice(0, 10);
	return { defaults: { from, to } };
};
