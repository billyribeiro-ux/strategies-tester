import { describe, it, expect } from 'vitest';
import { selectUniverseSymbols } from './select';
import type { UniverseMembership } from './types';

describe('selectUniverseSymbols', () => {
	it('unions symbols across in-range snapshots and de-duplicates', () => {
		const membership: UniverseMembership[] = [
			{ date: '2020-01-01', symbols: ['AAPL', 'MSFT'] },
			{ date: '2020-06-01', symbols: ['MSFT', 'TSLA'] }
		];
		const { symbols, capped } = selectUniverseSymbols(membership, '2020-01-01', '2020-12-31', 25);
		expect(symbols).toEqual(['AAPL', 'MSFT', 'TSLA']);
		expect(capped).toBe(false);
	});

	it('returns a sorted set (deterministic order)', () => {
		const membership: UniverseMembership[] = [
			{ date: '2020-01-01', symbols: ['ZM', 'AAPL', 'MSFT'] }
		];
		const { symbols } = selectUniverseSymbols(membership, '2020-01-01', '2020-12-31', 25);
		expect(symbols).toEqual(['AAPL', 'MSFT', 'ZM']);
	});

	it('caps deterministically to the first N after sorting', () => {
		const membership: UniverseMembership[] = [
			{ date: '2020-01-01', symbols: ['DDD', 'BBB', 'AAA', 'CCC', 'EEE'] }
		];
		const { symbols, capped } = selectUniverseSymbols(membership, '2020-01-01', '2020-12-31', 3);
		expect(symbols).toEqual(['AAA', 'BBB', 'CCC']);
		expect(capped).toBe(true);
	});

	it('reports capped=false when the union fits exactly', () => {
		const membership: UniverseMembership[] = [{ date: '2020-01-01', symbols: ['AAA', 'BBB'] }];
		const { symbols, capped } = selectUniverseSymbols(membership, '2020-01-01', '2020-12-31', 2);
		expect(symbols).toEqual(['AAA', 'BBB']);
		expect(capped).toBe(false);
	});

	it('excludes snapshots outside the run window (point-in-time / leak-safe)', () => {
		const membership: UniverseMembership[] = [
			{ date: '2019-01-01', symbols: ['OLD'] }, // before window
			{ date: '2020-03-01', symbols: ['INRANGE'] }, // inside window
			{ date: '2021-01-01', symbols: ['FUTURE'] } // after window
		];
		const { symbols } = selectUniverseSymbols(membership, '2020-01-01', '2020-12-31', 25);
		expect(symbols).toEqual(['INRANGE']);
	});

	it('includes snapshots on the inclusive window boundaries', () => {
		const membership: UniverseMembership[] = [
			{ date: '2020-01-01', symbols: ['START'] },
			{ date: '2020-12-31', symbols: ['END'] }
		];
		const { symbols } = selectUniverseSymbols(membership, '2020-01-01', '2020-12-31', 25);
		expect(symbols).toEqual(['END', 'START']);
	});

	it('normalizes symbols (trim + uppercase) before union', () => {
		const membership: UniverseMembership[] = [
			{ date: '2020-01-01', symbols: [' aapl ', 'AAPL', 'msft'] }
		];
		const { symbols } = selectUniverseSymbols(membership, '2020-01-01', '2020-12-31', 25);
		expect(symbols).toEqual(['AAPL', 'MSFT']);
	});

	it('empty membership yields empty symbols, not capped', () => {
		const { symbols, capped } = selectUniverseSymbols([], '2020-01-01', '2020-12-31', 25);
		expect(symbols).toEqual([]);
		expect(capped).toBe(false);
	});

	it('all snapshots out of range yields empty symbols', () => {
		const membership: UniverseMembership[] = [{ date: '2019-01-01', symbols: ['OLD'] }];
		const { symbols, capped } = selectUniverseSymbols(membership, '2020-01-01', '2020-12-31', 25);
		expect(symbols).toEqual([]);
		expect(capped).toBe(false);
	});
});
