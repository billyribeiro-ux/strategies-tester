import { describe, it, expect } from 'vitest';
import type { Candle } from '$lib/types';
import { CAPABILITIES } from '$lib/capabilities/catalog';
import { ParamReader } from './compute';
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
	computeWMA
} from './compute';
import { INDICATOR_REGISTRY, assertRegistryCoversCatalog, getComputeFn } from './registry';

/** Build candles where close = the given series; o/h/l track close, v constant. */
function closeCandles(closes: number[], volume = 100): Candle[] {
	return closes.map((c, i) => ({
		t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
		o: c,
		h: c,
		l: c,
		c,
		v: volume
	}));
}

/** Build OHLC candles explicitly. */
function ohlc(rows: Array<[number, number, number, number, number?]>): Candle[] {
	return rows.map(([o, h, l, c, v], i) => ({
		t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
		o,
		h,
		l,
		c,
		v: v ?? 100
	}));
}

const reader = (p: Record<string, number | string | boolean>) => new ParamReader(p);

const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('registry coverage', () => {
	it('implements a compute fn for every catalogued indicator', () => {
		const covered = assertRegistryCoversCatalog();
		expect(covered.length).toBe(CAPABILITIES.indicators.length);
	});

	it('exposes a function via getComputeFn for each catalog type', () => {
		for (const cap of CAPABILITIES.indicators) {
			expect(typeof getComputeFn(cap.type)).toBe('function');
		}
		expect(getComputeFn('not-a-real-indicator')).toBeUndefined();
	});

	it('every registry key is present in the catalog', () => {
		const catalogTypes = new Set(CAPABILITIES.indicators.map((c) => c.type));
		for (const key of Object.keys(INDICATOR_REGISTRY)) {
			expect(catalogTypes.has(key)).toBe(true);
		}
	});
});

describe('SMA', () => {
	it('matches hand-computed values for period 3', () => {
		const out = computeSMA(
			closeCandles([1, 2, 3, 4, 5]),
			reader({ period: 3 }),
			'close'
		) as number[];
		expect(Number.isNaN(out[0])).toBe(true);
		expect(Number.isNaN(out[1])).toBe(true);
		expect(out[2]).toBeCloseTo(2, 12);
		expect(out[3]).toBeCloseTo(3, 12);
		expect(out[4]).toBeCloseTo(4, 12);
	});
});

describe('EMA', () => {
	it('seeds with the SMA and smooths thereafter (period 3)', () => {
		const out = computeEMA(
			closeCandles([1, 2, 3, 4, 5]),
			reader({ period: 3 }),
			'close'
		) as number[];
		expect(Number.isNaN(out[1])).toBe(true);
		expect(out[2]).toBeCloseTo(2, 12); // seed = SMA(3) of 1,2,3
		expect(out[3]).toBeCloseTo(3, 12); // 4*.5 + 2*.5
		expect(out[4]).toBeCloseTo(4, 12); // 5*.5 + 3*.5
	});
});

describe('WMA', () => {
	it('linearly weights the window favouring recent bars', () => {
		const out = computeWMA(closeCandles([1, 2, 3]), reader({ period: 3 }), 'close') as number[];
		expect(Number.isNaN(out[1])).toBe(true);
		expect(out[2]).toBeCloseTo(14 / 6, 12); // (1*1 + 2*2 + 3*3)/6
	});
});

describe('RSI', () => {
	it('returns 100 for a strictly rising series', () => {
		const closes = Array.from({ length: 20 }, (_, i) => 10 + i);
		const out = computeRSI(closeCandles(closes), reader({ period: 14 }), 'close') as number[];
		expect(Number.isNaN(out[13])).toBe(true);
		expect(out[14]).toBeCloseTo(100, 9);
	});

	it('returns ~0 for a strictly falling series', () => {
		const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
		const out = computeRSI(closeCandles(closes), reader({ period: 14 }), 'close') as number[];
		expect(out[14]).toBeCloseTo(0, 9);
	});

	it('matches a hand-computed value for a known mixed series (period 3)', () => {
		// changes: +1, +1, -1, +1 → seed avgGain=2/3, avgLoss=1/3 at i=3.
		const closes = [10, 11, 12, 11, 12];
		const out = computeRSI(closeCandles(closes), reader({ period: 3 }), 'close') as number[];
		// i=3 seed: avgGain=(1+1+0)/3=2/3, avgLoss=(0+0+1)/3=1/3 → RS=2, RSI=100-100/3
		expect(out[3]).toBeCloseTo(100 - 100 / 3, 9);
		// i=4: avgGain=(2/3*2 + 1)/3=(4/3+1)/3=7/9; avgLoss=(1/3*2+0)/3=2/9 → RS=3.5
		const rs = 7 / 9 / (2 / 9);
		expect(out[4]).toBeCloseTo(100 - 100 / (1 + rs), 9);
	});
});

describe('MACD', () => {
	it('produces three aligned components with macd = fastEMA - slowEMA', () => {
		const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.2);
		const candles = closeCandles(closes);
		const macd = computeMACD(candles, reader({ fast: 12, slow: 26, signal: 9 }), 'close') as Record<
			string,
			number[]
		>;
		expect(macd.macd.length).toBe(closes.length);
		expect(macd.signal.length).toBe(closes.length);
		expect(macd.histogram.length).toBe(closes.length);
		const fast = computeEMA(candles, reader({ period: 12 }), 'close') as number[];
		const slow = computeEMA(candles, reader({ period: 26 }), 'close') as number[];
		// MACD line valid from slow EMA seed (index 25). Signal needs `signal`
		// more MACD values; pick a late index where all three are valid.
		const i = 50;
		expect(Number.isNaN(macd.macd[i])).toBe(false);
		expect(Number.isNaN(macd.signal[i])).toBe(false);
		expect(macd.macd[i]).toBeCloseTo(fast[i] - slow[i], 9);
		// histogram = macd - signal
		expect(macd.histogram[i]).toBeCloseTo(macd.macd[i] - macd.signal[i], 9);
	});
});

describe('ATR', () => {
	it('first smoothed value equals the average true range over the period', () => {
		// Build candles with a constant true range of 2 each bar.
		const rows: Array<[number, number, number, number]> = [];
		const base = 100;
		for (let i = 0; i < 20; i++) {
			rows.push([base, base + 1, base - 1, base]); // h-l = 2, prevClose=base → TR=2
		}
		const out = computeATR(ohlc(rows), reader({ period: 14 }), 'close') as number[];
		expect(out[13]).toBeCloseTo(2, 9);
		expect(out[14]).toBeCloseTo(2, 9);
	});
});

describe('Bollinger', () => {
	it('middle = SMA and bands are symmetric around it', () => {
		const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const out = computeBollinger(
			closeCandles(closes),
			reader({ period: 5, stdDev: 2 }),
			'close'
		) as Record<string, number[]>;
		const i = 9;
		expect(out.middle[i]).toBeCloseTo((6 + 7 + 8 + 9 + 10) / 5, 12);
		expect(out.upper[i] - out.middle[i]).toBeCloseTo(out.middle[i] - out.lower[i], 12);
	});
});

describe('Stochastic', () => {
	it('%K is 100 at a new high and 0 at a new low (no smoothing)', () => {
		const rows: Array<[number, number, number, number]> = [
			[10, 12, 8, 9],
			[10, 13, 9, 10],
			[10, 14, 10, 14], // close at the high → %K = 100
			[10, 15, 5, 5] // close at the low → %K = 0
		];
		const out = computeStochastic(
			ohlc(rows),
			reader({ kPeriod: 3, dPeriod: 1, smooth: 1 }),
			'close'
		) as Record<string, number[]>;
		expect(out.k[2]).toBeCloseTo(100, 9);
		expect(out.k[3]).toBeCloseTo(0, 9);
	});
});

describe('ADX', () => {
	it('produces bounded directional indices for a trending series', () => {
		const rows: Array<[number, number, number, number]> = [];
		let base = 50;
		for (let i = 0; i < 40; i++) {
			base += 1;
			rows.push([base, base + 1, base - 0.5, base + 0.5]);
		}
		const out = computeADX(ohlc(rows), reader({ period: 14 }), 'close') as Record<string, number[]>;
		const last = out.adx.length - 1;
		expect(out.plusDI[last]).toBeGreaterThan(out.minusDI[last]); // uptrend
		expect(out.adx[last]).toBeGreaterThanOrEqual(0);
		expect(out.adx[last]).toBeLessThanOrEqual(100);
	});
});

describe('OBV', () => {
	it('accumulates volume by close direction', () => {
		const rows: Array<[number, number, number, number, number]> = [
			[10, 10, 10, 10, 100],
			[10, 11, 10, 11, 200], // up → +200
			[11, 11, 10, 10, 150], // down → -150
			[10, 11, 10, 10, 300] // flat → +0
		];
		const out = computeOBV(ohlc(rows), reader({}), 'close') as number[];
		expect(out[0]).toBe(0);
		expect(out[1]).toBe(200);
		expect(out[2]).toBe(50);
		expect(out[3]).toBe(50);
	});
});

describe('ROC', () => {
	it('computes percentage change over the period', () => {
		const out = computeROC(
			closeCandles([10, 11, 12, 13, 14]),
			reader({ period: 2 }),
			'close'
		) as number[];
		expect(Number.isNaN(out[1])).toBe(true);
		expect(out[2]).toBeCloseTo(((12 - 10) / 10) * 100, 12); // 20
		expect(out[4]).toBeCloseTo(((14 - 12) / 12) * 100, 12);
	});
});

describe('CCI', () => {
	it('is zero when typical price equals its moving average', () => {
		const rows: Array<[number, number, number, number]> = Array.from({ length: 25 }, () => [
			10, 10, 10, 10
		]);
		const out = computeCCI(ohlc(rows), reader({ period: 20 }), 'hlc3') as number[];
		expect(out[24]).toBeCloseTo(0, 9);
	});
});

describe('Donchian', () => {
	it('upper = highest high, lower = lowest low, middle = midpoint', () => {
		const rows: Array<[number, number, number, number]> = [
			[10, 12, 8, 11],
			[10, 15, 9, 14],
			[10, 13, 5, 12]
		];
		const out = computeDonchian(ohlc(rows), reader({ period: 3 }), 'close') as Record<
			string,
			number[]
		>;
		expect(out.upper[2]).toBe(15);
		expect(out.lower[2]).toBe(5);
		expect(out.middle[2]).toBe(10);
	});
});

describe('VWAP', () => {
	it('continuous anchor equals cumulative price*volume / volume', () => {
		const rows: Array<[number, number, number, number, number]> = [
			[0, 10, 10, 10, 100],
			[0, 20, 20, 20, 100]
		];
		const out = computeVWAP(ohlc(rows), reader({ anchor: 'continuous' }), 'close') as number[];
		expect(out[0]).toBeCloseTo(10, 12);
		expect(out[1]).toBeCloseTo((10 * 100 + 20 * 100) / 200, 12); // 15
	});
});

describe('warm-up alignment', () => {
	it('all indicators return series aligned to candle length', () => {
		const candles = closeCandles(Array.from({ length: 50 }, (_, i) => 100 + i));
		for (const cap of CAPABILITIES.indicators) {
			const fn = getComputeFn(cap.type)!;
			const params: Record<string, number | string | boolean> = {};
			for (const p of cap.params) params[p.name] = p.default;
			const result = fn(candles, reader(params), cap.defaultPriceSource);
			if (Array.isArray(result)) {
				expect(result.length).toBe(candles.length);
			} else {
				for (const comp of cap.components) {
					expect(result[comp].length).toBe(candles.length);
				}
			}
		}
		expect(approx(1, 1)).toBe(true);
	});
});
