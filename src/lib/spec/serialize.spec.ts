import { describe, it, expect } from 'vitest';
import { createDefaultSpec, createBinaryLeaf, createIndicatorInstance, emptyGroup } from './defaults';
import { exportSpecJSON, importSpecJSON, stableStringify, cloneSpec } from './serialize';
import { indicatorCapability } from '$lib/capabilities/catalog';
import type { StrategySpec } from '$lib/types';

function richSpec(): StrategySpec {
	const spec = createDefaultSpec('Round-trip strategy');
	spec.universe.tickers = ['AAPL', 'MSFT'];
	const ema = createIndicatorInstance(indicatorCapability('ema')!);
	const sma = createIndicatorInstance(indicatorCapability('sma')!);
	spec.indicators = [ema, sma];
	const inner = emptyGroup('OR');
	inner.children = [
		createBinaryLeaf(
			{ kind: 'indicator', ref: ema.id, component: 'value', offset: 0 },
			'crossover',
			{ kind: 'indicator', ref: sma.id, component: 'value', offset: 0 }
		)
	];
	spec.rules.longEntry.children = [
		createBinaryLeaf({ kind: 'price', field: 'close', offset: 0 }, 'gt', { kind: 'constant', value: 10 }),
		inner
	];
	return spec;
}

describe('serialize round-trip', () => {
	it('default spec survives export → import unchanged in meaning', () => {
		const spec = createDefaultSpec('My strategy');
		const result = importSpecJSON(exportSpecJSON(spec));
		expect(result.success).toBe(true);
		if (result.success) expect(result.spec).toEqual(spec);
	});

	it('a nested, indicator-referencing spec round-trips losslessly', () => {
		const spec = richSpec();
		const result = importSpecJSON(exportSpecJSON(spec));
		expect(result.success).toBe(true);
		if (result.success) expect(result.spec).toEqual(spec);
	});

	it('export is deterministic regardless of key insertion order', () => {
		const a = { kind: 'group', id: 'g1', logic: 'AND', children: [] };
		const b = { children: [], logic: 'AND', id: 'g1', kind: 'group' };
		expect(stableStringify(a)).toBe(stableStringify(b));
	});

	it('re-exporting an imported spec is byte-identical', () => {
		const json = exportSpecJSON(richSpec());
		const round = importSpecJSON(json);
		expect(round.success).toBe(true);
		if (round.success) expect(exportSpecJSON(round.spec)).toBe(json);
	});

	it('rejects non-JSON input', () => {
		const result = importSpecJSON('not json {');
		expect(result.success).toBe(false);
	});

	it('rejects structurally invalid specs', () => {
		const result = importSpecJSON(JSON.stringify({ name: 'x', schemaVersion: 1 }));
		expect(result.success).toBe(false);
	});

	it('cloneSpec produces an equal but independent copy', () => {
		const spec = richSpec();
		const clone = cloneSpec(spec);
		expect(clone).toEqual(spec);
		clone.indicators[0].params.period = 999;
		expect(clone).not.toEqual(spec);
	});
});
