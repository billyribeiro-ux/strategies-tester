/**
 * The capability catalog — authored ONCE here as pure metadata.
 *
 * The server route `GET /api/capabilities` returns this payload, and the
 * backtest engine's indicator registry attaches a compute function to every
 * `type` listed here (a server-side test asserts full coverage). The client
 * NEVER imports this for rendering — it fetches `/api/capabilities` at runtime —
 * but tests and dev fixtures may import `CAPABILITIES` directly.
 *
 * Adding an indicator = one entry here + one compute function server-side; the
 * picker then reflects it automatically.
 */

import type { Capabilities, IndicatorCapability, OperatorCapability } from '$lib/types';
import {
	BINARY_OPERATORS,
	FILL_MODELS,
	ORDER_TYPES,
	PRICE_FIELDS,
	RANGE_OPERATORS,
	UNARY_OPERATORS,
	type PriceField
} from '$lib/types';
import { operatorMeta } from '$lib/spec/operators';

/** Price sources valid for price-based indicators (volume excluded). */
const PRICE_SOURCES: PriceField[] = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'];

const VALUE = ['value'];

const INDICATORS: IndicatorCapability[] = [
	{
		type: 'sma',
		label: 'Simple Moving Average',
		description: 'Unweighted mean of the price over the period.',
		params: [{ name: 'period', label: 'Period', kind: 'int', min: 1, max: 1000, default: 20 }],
		components: VALUE,
		defaultPriceSource: 'close',
		allowedPriceSources: PRICE_SOURCES,
		minBars: 20
	},
	{
		type: 'ema',
		label: 'Exponential Moving Average',
		description: 'Exponentially weighted moving average; reacts faster to recent prices.',
		params: [{ name: 'period', label: 'Period', kind: 'int', min: 1, max: 1000, default: 21 }],
		components: VALUE,
		defaultPriceSource: 'close',
		allowedPriceSources: PRICE_SOURCES,
		minBars: 21
	},
	{
		type: 'wma',
		label: 'Weighted Moving Average',
		description: 'Linearly weighted moving average favouring recent bars.',
		params: [{ name: 'period', label: 'Period', kind: 'int', min: 1, max: 1000, default: 20 }],
		components: VALUE,
		defaultPriceSource: 'close',
		allowedPriceSources: PRICE_SOURCES,
		minBars: 20
	},
	{
		type: 'vwap',
		label: 'VWAP',
		description: 'Volume-weighted average price, anchored per session or cumulative.',
		params: [
			{
				name: 'anchor',
				label: 'Anchor',
				kind: 'enum',
				options: [
					{ value: 'session', label: 'Session' },
					{ value: 'continuous', label: 'Continuous' }
				],
				default: 'session'
			}
		],
		components: VALUE,
		defaultPriceSource: 'hlc3',
		allowedPriceSources: ['hlc3', 'close', 'ohlc4'],
		minBars: 1
	},
	{
		type: 'rsi',
		label: 'Relative Strength Index',
		description: 'Momentum oscillator (0–100) measuring the speed of price changes.',
		params: [{ name: 'period', label: 'Period', kind: 'int', min: 2, max: 200, default: 14 }],
		components: VALUE,
		defaultPriceSource: 'close',
		allowedPriceSources: PRICE_SOURCES,
		minBars: 15
	},
	{
		type: 'macd',
		label: 'MACD',
		description: 'Moving Average Convergence Divergence with signal and histogram lines.',
		params: [
			{ name: 'fast', label: 'Fast period', kind: 'int', min: 1, max: 200, default: 12 },
			{ name: 'slow', label: 'Slow period', kind: 'int', min: 2, max: 400, default: 26 },
			{ name: 'signal', label: 'Signal period', kind: 'int', min: 1, max: 200, default: 9 }
		],
		components: ['macd', 'signal', 'histogram'],
		defaultPriceSource: 'close',
		allowedPriceSources: PRICE_SOURCES,
		minBars: 35
	},
	{
		type: 'atr',
		label: 'Average True Range',
		description: 'Volatility measure based on the true range of each bar (uses H/L/C).',
		params: [{ name: 'period', label: 'Period', kind: 'int', min: 1, max: 200, default: 14 }],
		components: VALUE,
		defaultPriceSource: 'close',
		allowedPriceSources: ['close'],
		minBars: 15
	},
	{
		type: 'bollinger',
		label: 'Bollinger Bands',
		description: 'Moving average with upper/lower bands at N standard deviations.',
		params: [
			{ name: 'period', label: 'Period', kind: 'int', min: 2, max: 400, default: 20 },
			{
				name: 'stdDev',
				label: 'Std. deviations',
				kind: 'float',
				min: 0.1,
				max: 10,
				step: 0.1,
				default: 2
			}
		],
		components: ['upper', 'middle', 'lower'],
		defaultPriceSource: 'close',
		allowedPriceSources: PRICE_SOURCES,
		minBars: 20
	},
	{
		type: 'stochastic',
		label: 'Stochastic Oscillator',
		description: 'Momentum oscillator comparing close to the recent high/low range.',
		params: [
			{ name: 'kPeriod', label: '%K period', kind: 'int', min: 1, max: 200, default: 14 },
			{ name: 'dPeriod', label: '%D period', kind: 'int', min: 1, max: 100, default: 3 },
			{ name: 'smooth', label: '%K smoothing', kind: 'int', min: 1, max: 100, default: 3 }
		],
		components: ['k', 'd'],
		defaultPriceSource: 'close',
		allowedPriceSources: ['close'],
		minBars: 20
	},
	{
		type: 'adx',
		label: 'Average Directional Index',
		description: 'Trend-strength index with +DI and −DI directional components.',
		params: [{ name: 'period', label: 'Period', kind: 'int', min: 1, max: 200, default: 14 }],
		components: ['adx', 'plusDI', 'minusDI'],
		defaultPriceSource: 'close',
		allowedPriceSources: ['close'],
		minBars: 28
	},
	{
		type: 'obv',
		label: 'On-Balance Volume',
		description: 'Cumulative volume flow that adds/subtracts volume by price direction.',
		params: [],
		components: VALUE,
		defaultPriceSource: 'close',
		allowedPriceSources: ['close'],
		minBars: 2
	},
	{
		type: 'roc',
		label: 'Rate of Change',
		description: 'Percentage change of price over the period.',
		params: [{ name: 'period', label: 'Period', kind: 'int', min: 1, max: 400, default: 12 }],
		components: VALUE,
		defaultPriceSource: 'close',
		allowedPriceSources: PRICE_SOURCES,
		minBars: 13
	},
	{
		type: 'cci',
		label: 'Commodity Channel Index',
		description: 'Oscillator measuring deviation of typical price from its average.',
		params: [{ name: 'period', label: 'Period', kind: 'int', min: 2, max: 400, default: 20 }],
		components: VALUE,
		defaultPriceSource: 'hlc3',
		allowedPriceSources: ['hlc3', 'close'],
		minBars: 20
	},
	{
		type: 'donchian',
		label: 'Donchian Channels',
		description: 'Highest high / lowest low channel over the period with midline.',
		params: [{ name: 'period', label: 'Period', kind: 'int', min: 1, max: 400, default: 20 }],
		components: ['upper', 'middle', 'lower'],
		defaultPriceSource: 'close',
		allowedPriceSources: ['close'],
		minBars: 20
	}
];

const OPERATORS: OperatorCapability[] = [...BINARY_OPERATORS, ...UNARY_OPERATORS, ...RANGE_OPERATORS].map(
	(id) => {
		const m = operatorMeta(id);
		return { id: m.id, label: m.label, arity: m.arity, description: m.description };
	}
);

export const CAPABILITIES: Capabilities = {
	schemaVersion: 1,
	indicators: INDICATORS,
	operators: OPERATORS,
	timeframes: [
		{ id: '1m', label: '1 minute', seconds: 60, intraday: true },
		{ id: '5m', label: '5 minutes', seconds: 300, intraday: true },
		{ id: '15m', label: '15 minutes', seconds: 900, intraday: true },
		{ id: '30m', label: '30 minutes', seconds: 1800, intraday: true },
		{ id: '1h', label: '1 hour', seconds: 3600, intraday: true },
		{ id: '4h', label: '4 hours', seconds: 14400, intraday: true },
		{ id: '1d', label: 'Daily', seconds: 86400, intraday: false },
		{ id: '1w', label: 'Weekly', seconds: 604800, intraday: false }
	],
	priceSources: [...PRICE_FIELDS],
	fillModels: [...FILL_MODELS],
	orderTypes: [...ORDER_TYPES]
};

/** Convenience lookup by indicator type. */
export function indicatorCapability(type: string): IndicatorCapability | undefined {
	return CAPABILITIES.indicators.find((i) => i.type === type);
}
