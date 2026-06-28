/**
 * LEAK GATE — the mandatory correctness checkpoint (spec §0, §2.1, §6).
 *
 * A backtest has no look-ahead IFF, for any cut point K in time, every trade
 * that is already FULLY SETTLED at or before bar K is completely unchanged when
 * all bars strictly after K are replaced with arbitrary (adversarial) values.
 *
 * Intuition: a decision made at bar T may only use information timestamped <= T.
 * If we corrupt the future and a trade that finished in the past changes, the
 * engine must have read that future to produce it — a leak, by definition.
 *
 * This is the gold-standard, engine-agnostic test: it makes ZERO assumptions
 * about *how* the runner works. It takes any `TradeRunner` (the real engine, a
 * variant, or a deliberately-cheating fixture) and empirically proves whether it
 * reads the future. The accompanying spec proves it (a) passes the real engine
 * and (b) CATCHES a planted leak — if a planted leak ever passes, the harness is
 * broken and must be fixed before anything else proceeds.
 *
 * PURE: no network, no DB, no clock. Deterministic for deterministic runners.
 */

import type { Candle, StrategySpec, Trade } from '$lib/types';
import { runBacktest } from './engine';

/** A unit under test: given a single ticker's candles, produce its trades. */
export type TradeRunner = (candles: Candle[]) => Trade[];

export interface LeakEvidence {
	/** Bar index of the cut whose future was perturbed. */
	cutIndex: number;
	/** Timestamp of the cut bar. */
	cutTime: string;
	/** Human-readable description of the divergence. */
	detail: string;
	/** The settled-trade projection from the clean run (for inspection). */
	baseline: string;
	/** The settled-trade projection from the future-perturbed run. */
	perturbed: string;
}

export interface LeakReport {
	leaked: boolean;
	cutsChecked: number;
	/** Number of settled trades compared, summed across all cuts (test strength). */
	tradesCompared: number;
	evidence: LeakEvidence[];
}

export interface LeakGateOptions {
	/** Explicit cut indices to test. Defaults to ~12 evenly spaced interior cuts. */
	cuts?: number[];
	/** Stop at the first divergence instead of collecting all. Default false. */
	failFast?: boolean;
}

/**
 * Replace OHLCV of every bar AFTER `cutIndex` with adversarial values while
 * preserving timestamps (so timeline alignment is untouched and only *price*
 * information is corrupted). The pattern oscillates between extreme high/low so
 * that ANY future peek — a comparison, a crossover, a fill — flips its outcome.
 * Each emitted bar is a valid candle (h >= max(o,c), l <= min(o,c)).
 */
export function perturbAfter(candles: Candle[], cutIndex: number): Candle[] {
	const BIG = 1_000_000;
	const SMALL = 0.01;
	return candles.map((c, j) => {
		if (j <= cutIndex) return c;
		const up = j % 2 === 0;
		const open = up ? SMALL : BIG;
		const close = up ? BIG : SMALL;
		return {
			t: c.t,
			o: open,
			h: BIG * 2,
			l: SMALL / 2,
			c: close,
			v: 1_000_000_000
		};
	});
}

/** Default interior cut points: ~12 evenly spaced indices across [20%, 80%]. */
function defaultCuts(n: number): number[] {
	if (n < 6) return [];
	const lo = Math.max(1, Math.floor(n * 0.2));
	const hi = Math.min(n - 2, Math.floor(n * 0.8));
	if (hi <= lo) return [Math.floor(n / 2)];
	const count = Math.min(12, hi - lo + 1);
	const out: number[] = [];
	for (let k = 0; k < count; k++) {
		out.push(Math.round(lo + ((hi - lo) * k) / (count - 1)));
	}
	return [...new Set(out)];
}

/** Stable projection of the fields a settled trade must reproduce exactly. */
function project(t: Trade): string {
	return JSON.stringify([
		t.ticker,
		t.side,
		t.entryTime,
		t.entryPrice,
		t.exitTime,
		t.exitPrice,
		t.qty,
		t.pnl
	]);
}

/**
 * Run the future-invariance leak test against a runner over one candle series.
 *
 * For each cut K: perturb all bars after K, re-run, and compare — in order — the
 * trades whose EXIT falls at a bar index <= K (i.e. fully settled using only
 * bars <= K). They must be identical. Any add/remove/change is proof of a leak.
 */
export function detectLookahead(
	run: TradeRunner,
	candles: Candle[],
	options: LeakGateOptions = {}
): LeakReport {
	const n = candles.length;
	const timeToIndex = new Map<string, number>();
	candles.forEach((c, i) => timeToIndex.set(c.t, i));

	/** Index of a trade's exit bar, or +∞ if its exit time is unknown. */
	const exitIndex = (t: Trade): number => timeToIndex.get(t.exitTime) ?? Number.POSITIVE_INFINITY;

	const baselineTrades = run(candles);
	const cuts = (options.cuts ?? defaultCuts(n)).filter((k) => k >= 0 && k < n - 1);

	const evidence: LeakEvidence[] = [];
	let tradesCompared = 0;

	for (const cut of cuts) {
		const settledBaseline = baselineTrades.filter((t) => exitIndex(t) <= cut).map(project);
		const perturbedTrades = run(perturbAfter(candles, cut));
		const settledPerturbed = perturbedTrades.filter((t) => exitIndex(t) <= cut).map(project);

		tradesCompared += settledBaseline.length;

		const same =
			settledBaseline.length === settledPerturbed.length &&
			settledBaseline.every((p, i) => p === settledPerturbed[i]);

		if (!same) {
			evidence.push({
				cutIndex: cut,
				cutTime: candles[cut].t,
				detail:
					`Settled-trade set diverged after corrupting bars > ${cut}: ` +
					`${settledBaseline.length} clean vs ${settledPerturbed.length} perturbed. ` +
					`A trade finished on/before the cut changed when only the FUTURE changed.`,
				baseline: JSON.stringify(settledBaseline),
				perturbed: JSON.stringify(settledPerturbed)
			});
			if (options.failFast) break;
		}
	}

	return {
		leaked: evidence.length > 0,
		cutsChecked: cuts.length,
		tradesCompared,
		evidence
	};
}

/**
 * Run the leak gate against the REAL engine for a spec, isolating each ticker as
 * its own single-symbol series (the engine's entire look-ahead surface is
 * per-ticker: indicator/price access and the next-bar-open fill). Returns a
 * combined report; `leaked === true` means the engine failed the gate and the
 * results are not trustworthy.
 */
export function runLeakGate(
	spec: StrategySpec,
	candlesByTicker: Record<string, Candle[]>,
	options: LeakGateOptions = {}
): LeakReport {
	const evidence: LeakEvidence[] = [];
	let cutsChecked = 0;
	let tradesCompared = 0;

	for (const ticker of Object.keys(candlesByTicker)) {
		const candles = candlesByTicker[ticker] ?? [];
		if (candles.length < 6) continue;
		const runner: TradeRunner = (c) => runBacktest(spec, { [ticker]: c }).trades;
		const report = detectLookahead(runner, candles, options);
		cutsChecked += report.cutsChecked;
		tradesCompared += report.tradesCompared;
		evidence.push(...report.evidence);
		if (options.failFast && evidence.length > 0) break;
	}

	return { leaked: evidence.length > 0, cutsChecked, tradesCompared, evidence };
}

/** Throw a descriptive error if the gate detects a leak. For engine self-tests. */
export function assertNoLookahead(
	spec: StrategySpec,
	candlesByTicker: Record<string, Candle[]>,
	options: LeakGateOptions = {}
): void {
	const report = runLeakGate(spec, candlesByTicker, options);
	if (report.leaked) {
		const first = report.evidence[0];
		throw new Error(
			`LEAK GATE FAILED: the engine read future data. ${first?.detail ?? ''} ` +
				`(${report.evidence.length} divergence(s) across ${report.cutsChecked} cuts).`
		);
	}
}
