import { describe, it, expect } from 'vitest';
import { validateSpec, hasErrors, type SpecIssue } from './validate-spec';
import { CAPABILITIES, indicatorCapability } from '$lib/capabilities/catalog';
import {
	createDefaultSpec,
	createBinaryLeaf,
	createUnaryLeaf,
	createRangeLeaf,
	createIndicatorInstance
} from '$lib/spec/defaults';
import type { StrategySpec } from '$lib/types';

/** A minimal spec that should validate without errors. */
function validSpec(): StrategySpec {
	const spec = createDefaultSpec('Valid');
	spec.universe.tickers = ['AAPL'];
	const ema = createIndicatorInstance(indicatorCapability('ema')!);
	spec.indicators = [ema];
	spec.rules.longEntry.children = [
		createBinaryLeaf({ kind: 'price', field: 'close', offset: 0 }, 'crossover', {
			kind: 'indicator',
			ref: ema.id,
			component: 'value',
			offset: 0
		})
	];
	spec.rules.longExit.children = [
		createBinaryLeaf({ kind: 'price', field: 'close', offset: 0 }, 'crossunder', {
			kind: 'indicator',
			ref: ema.id,
			component: 'value',
			offset: 0
		})
	];
	return spec;
}

const v = (spec: StrategySpec): SpecIssue[] => validateSpec(spec, CAPABILITIES);

describe('validateSpec', () => {
	it('flags a default spec as invalid (no tickers, no entries)', () => {
		const issues = v(createDefaultSpec());
		expect(hasErrors(issues)).toBe(true);
		expect(issues.some((i) => i.path === 'universe.tickers')).toBe(true);
		expect(issues.some((i) => i.path.startsWith('rules.'))).toBe(true);
	});

	it('passes a minimal valid spec', () => {
		expect(hasErrors(v(validSpec()))).toBe(false);
	});

	it('errors when risk-based sizing has no stop', () => {
		const spec = validSpec();
		spec.risk.positionSizing = { mode: 'riskBased', riskPercent: 1 };
		spec.risk.stopLoss = { mode: 'none' };
		const issues = v(spec);
		expect(issues.some((i) => i.path === 'risk.positionSizing' && i.severity === 'error')).toBe(
			true
		);
	});

	it('errors on rising/falling applied to a constant', () => {
		const spec = validSpec();
		spec.rules.longEntry.children = [createUnaryLeaf({ kind: 'constant', value: 5 }, 'rising', 1)];
		expect(hasErrors(v(spec))).toBe(true);
	});

	it('errors when range bounds are inverted', () => {
		const spec = validSpec();
		spec.rules.longEntry.children = [
			createRangeLeaf(
				{ kind: 'price', field: 'close', offset: 0 },
				'insideRange',
				{ kind: 'constant', value: 100 },
				{ kind: 'constant', value: 10 }
			)
		];
		expect(hasErrors(v(spec))).toBe(true);
	});

	it('errors when an operand references a missing indicator', () => {
		const spec = validSpec();
		spec.rules.longEntry.children = [
			createBinaryLeaf({ kind: 'price', field: 'close', offset: 0 }, 'gt', {
				kind: 'indicator',
				ref: 'does-not-exist',
				component: 'value',
				offset: 0
			})
		];
		const issues = v(spec);
		expect(issues.some((i) => i.severity === 'error' && i.nodeId)).toBe(true);
	});

	it('errors when an indicator parameter is out of range', () => {
		const spec = validSpec();
		spec.indicators[0].params.period = -5;
		expect(hasErrors(v(spec))).toBe(true);
	});

	it('errors when an ATR stop references a non-ATR indicator', () => {
		const spec = validSpec();
		// spec.indicators[0] is an EMA, not ATR
		spec.risk.stopLoss = { mode: 'atr', atrRef: spec.indicators[0].id, multiple: 2 };
		const issues = v(spec);
		expect(issues.some((i) => i.path === 'risk.stopLoss' && i.severity === 'error')).toBe(true);
	});

	it('allows a HIGHER indicator timeframe than the universe (§3 MTF)', () => {
		const spec = validSpec();
		spec.universe.timeframe = '1h';
		spec.indicators[0].timeframe = '4h'; // higher than 1h → allowed
		expect(hasErrors(v(spec))).toBe(false);
	});

	it('allows an indicator timeframe equal to the universe', () => {
		const spec = validSpec();
		spec.universe.timeframe = '1h';
		spec.indicators[0].timeframe = '1h';
		expect(hasErrors(v(spec))).toBe(false);
	});

	it('errors on an indicator timeframe LOWER than the universe', () => {
		const spec = validSpec();
		spec.universe.timeframe = '1d';
		spec.indicators[0].timeframe = '1h'; // lower than 1d → fabricated sub-bar data
		const issues = v(spec);
		expect(issues.some((i) => i.path === 'indicators[0].timeframe' && i.severity === 'error')).toBe(
			true
		);
	});

	it('errors on an unknown indicator timeframe', () => {
		const spec = validSpec();
		spec.indicators[0].timeframe = 'bogus';
		const issues = v(spec);
		expect(issues.some((i) => i.path === 'indicators[0].timeframe' && i.severity === 'error')).toBe(
			true
		);
	});

	it('requires a component for multi-output indicators', () => {
		const spec = validSpec();
		const macd = createIndicatorInstance(indicatorCapability('macd')!);
		spec.indicators.push(macd);
		spec.rules.longEntry.children = [
			createBinaryLeaf({ kind: 'price', field: 'close', offset: 0 }, 'gt', {
				kind: 'indicator',
				ref: macd.id,
				offset: 0
				// no component chosen
			})
		];
		expect(hasErrors(v(spec))).toBe(true);
	});
});
