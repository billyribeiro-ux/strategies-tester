import { describe, it, expect } from 'vitest';
import { parseSpec } from './schema';
import { createDefaultSpec, createBinaryLeaf } from '$lib/spec/defaults';

describe('parseSpec (zod boundary)', () => {
	it('accepts a default spec', () => {
		expect(parseSpec(createDefaultSpec()).success).toBe(true);
	});

	it('accepts a spec with nested condition groups', () => {
		const spec = createDefaultSpec();
		spec.rules.longEntry.children = [
			createBinaryLeaf({ kind: 'price', field: 'close', offset: 0 }, 'gt', {
				kind: 'constant',
				value: 1
			}),
			{
				kind: 'group',
				id: 'g',
				logic: 'OR',
				children: [createBinaryLeaf({ kind: 'price', field: 'high', offset: 1 }, 'lt', { kind: 'constant', value: 2 })]
			}
		];
		expect(parseSpec(spec).success).toBe(true);
	});

	it('rejects unknown operand kinds', () => {
		const spec = createDefaultSpec() as unknown as Record<string, unknown>;
		(spec.rules as { longEntry: { children: unknown[] } }).longEntry.children = [
			{ kind: 'binary', id: 'x', left: { kind: 'nope', offset: 0 }, op: 'gt', right: { kind: 'constant', value: 1 } }
		];
		expect(parseSpec(spec).success).toBe(false);
	});

	it('rejects negative offsets', () => {
		const spec = createDefaultSpec();
		spec.rules.longEntry.children = [
			createBinaryLeaf({ kind: 'price', field: 'close', offset: -1 }, 'gt', { kind: 'constant', value: 1 })
		];
		expect(parseSpec(spec).success).toBe(false);
	});

	it('rejects non-objects', () => {
		expect(parseSpec(42).success).toBe(false);
		expect(parseSpec(null).success).toBe(false);
	});
});
