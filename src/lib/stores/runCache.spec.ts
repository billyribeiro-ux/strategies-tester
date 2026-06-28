import { afterEach, describe, expect, it } from 'vitest';
import type { BacktestResult } from '$lib/types';
import { clearRunCache, peekRun, rememberRun } from './runCache';

/** Minimal stand-in — the cache stores the result opaquely, keyed by runId. */
function mk(runId: string): BacktestResult {
	return { runId, trades: [], metrics: [], warnings: [] } as unknown as BacktestResult;
}

afterEach(() => clearRunCache());

describe('runCache', () => {
	it('round-trips a remembered result by runId', () => {
		const r = mk('run_a');
		rememberRun(r);
		expect(peekRun('run_a')).toBe(r);
	});

	it('returns null for a runId that was never remembered', () => {
		expect(peekRun('run_missing')).toBeNull();
	});

	it('peek does not consume — the entry survives repeated reads (reload-in-place)', () => {
		rememberRun(mk('run_b'));
		expect(peekRun('run_b')).not.toBeNull();
		expect(peekRun('run_b')).not.toBeNull();
	});

	it('ignores results with a missing or empty runId', () => {
		rememberRun({ runId: '' } as unknown as BacktestResult);
		rememberRun({} as unknown as BacktestResult);
		expect(peekRun('')).toBeNull();
	});

	it('evicts the oldest entry once more than 8 runs are cached', () => {
		for (let i = 0; i < 9; i++) rememberRun(mk(`run_${i}`));
		expect(peekRun('run_0')).toBeNull(); // oldest evicted
		expect(peekRun('run_1')).not.toBeNull();
		expect(peekRun('run_8')).not.toBeNull(); // newest retained
	});

	it('re-remembering a runId refreshes its recency so it is not evicted next', () => {
		for (let i = 0; i < 8; i++) rememberRun(mk(`run_${i}`)); // fills 0..7
		rememberRun(mk('run_0')); // refresh run_0 -> run_1 is now oldest
		rememberRun(mk('run_new')); // evicts the oldest (run_1)
		expect(peekRun('run_0')).not.toBeNull();
		expect(peekRun('run_1')).toBeNull();
		expect(peekRun('run_new')).not.toBeNull();
	});
});
