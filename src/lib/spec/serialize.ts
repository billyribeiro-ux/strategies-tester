/**
 * Deterministic serialization for export/import.
 *
 * `exportSpecJSON` produces canonical JSON (object keys sorted, array order
 * preserved) so exports are stable and diffable. `importSpecJSON` parses,
 * structurally validates (zod) and migrates the schema version, guaranteeing a
 * re-imported spec is identical in meaning to the one exported.
 *
 * Callers in components must pass a plain object — take `$state.snapshot(spec)`
 * before serializing so no reactive proxy leaks out.
 */

import type { StrategySpec } from '$lib/types';
import { SPEC_SCHEMA_VERSION } from '$lib/types';
import { parseSpec } from '$lib/validation/schema';

/** Canonical JSON.stringify with recursively sorted object keys. */
export function stableStringify(value: unknown, indent = 2): string {
	const seen = new WeakSet();
	const canon = (v: unknown): unknown => {
		if (v === null || typeof v !== 'object') return v;
		if (seen.has(v as object)) throw new Error('Cannot serialize a cyclic structure');
		seen.add(v as object);
		if (Array.isArray(v)) {
			const arr = v.map(canon);
			seen.delete(v as object);
			return arr;
		}
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(v as Record<string, unknown>).sort()) {
			const val = (v as Record<string, unknown>)[key];
			if (val === undefined) continue; // drop undefined for stable output
			out[key] = canon(val);
		}
		seen.delete(v as object);
		return out;
	};
	return JSON.stringify(canon(value), null, indent);
}

/** Migrate an older spec shape forward. No migrations needed yet. */
export function migrateSpec(spec: StrategySpec): StrategySpec {
	if (spec.schemaVersion === SPEC_SCHEMA_VERSION) return spec;
	// Future migrations branch on spec.schemaVersion here.
	return { ...spec, schemaVersion: SPEC_SCHEMA_VERSION };
}

export function exportSpecJSON(spec: StrategySpec): string {
	return stableStringify(spec);
}

export type ImportResult =
	| { success: true; spec: StrategySpec }
	| { success: false; error: string };

export function importSpecJSON(text: string): ImportResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { success: false, error: 'File is not valid JSON.' };
	}
	const parsed = parseSpec(raw);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		const where = first?.path?.length ? ` at ${first.path.join('.')}` : '';
		return {
			success: false,
			error: `Invalid strategy file${where}: ${first?.message ?? 'unknown error'}`
		};
	}
	return { success: true, spec: migrateSpec(parsed.data) };
}

/** Deep, proxy-free clone of a spec (e.g. for duplicate). */
export function cloneSpec(spec: StrategySpec): StrategySpec {
	return structuredClone(spec);
}
