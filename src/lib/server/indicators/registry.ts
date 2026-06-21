/**
 * Indicator registry — the single map from an `IndicatorType` to its compute
 * function. The capability catalog is metadata; this attaches behaviour. A test
 * (`assertRegistryCoversCatalog`) guarantees every catalogued indicator has an
 * implementation, so adding an indicator means: one catalog entry + one compute
 * function + one registry line.
 */

import type { IndicatorType } from '$lib/types';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import {
	computeADX,
	computeATR,
	computeBollinger,
	computeCCI,
	computeDonchian,
	computeEMA,
	computeMACD,
	computeOBV,
	computeROC,
	computeRSI,
	computeSMA,
	computeStochastic,
	computeVWAP,
	computeWMA,
	type ComputeFn
} from './compute';

/** Every indicator type the engine can evaluate. */
export const INDICATOR_REGISTRY: Record<IndicatorType, ComputeFn> = {
	sma: computeSMA,
	ema: computeEMA,
	wma: computeWMA,
	vwap: computeVWAP,
	rsi: computeRSI,
	macd: computeMACD,
	atr: computeATR,
	bollinger: computeBollinger,
	stochastic: computeStochastic,
	adx: computeADX,
	obv: computeOBV,
	roc: computeROC,
	cci: computeCCI,
	donchian: computeDonchian
};

/** Look up a compute function by indicator type, if implemented. */
export function getComputeFn(type: IndicatorType): ComputeFn | undefined {
	return INDICATOR_REGISTRY[type];
}

/**
 * Assert that the registry implements every indicator declared in the
 * capabilities catalog. Throws (with the offending types) when it doesn't.
 * Returns the list of covered types so a test can additionally assert the count.
 */
export function assertRegistryCoversCatalog(): IndicatorType[] {
	const missing: IndicatorType[] = [];
	for (const cap of CAPABILITIES.indicators) {
		if (typeof INDICATOR_REGISTRY[cap.type] !== 'function') missing.push(cap.type);
	}
	if (missing.length > 0) {
		throw new Error(
			`Indicator registry is missing compute functions for: ${missing.join(', ')}`
		);
	}
	return CAPABILITIES.indicators.map((c) => c.type);
}
