/** GET /api/candles?symbol&timeframe&from&to — normalized OHLC for charts. */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchCandles } from '$lib/server/fmp/client';

export const GET: RequestHandler = async ({ url, fetch }) => {
	const symbol = url.searchParams.get('symbol')?.trim();
	const timeframe = url.searchParams.get('timeframe')?.trim();
	const from = url.searchParams.get('from')?.trim();
	const to = url.searchParams.get('to')?.trim();

	if (!symbol || !timeframe || !from || !to) {
		throw error(400, { message: 'symbol, timeframe, from and to are all required.' });
	}

	try {
		const candles = await fetchCandles({ symbol, timeframe, from, to }, fetch);
		return json(candles);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Market data unavailable.';
		throw error(502, { message: `Market data unavailable: ${message}` });
	}
};
