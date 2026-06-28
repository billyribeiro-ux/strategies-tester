/**
 * Validation orchestration (spec §6) — assembles the pure statistics into one
 * `ValidationReport` the API returns and the UI renders. Two entry points:
 *
 *  - validateSingle(spec, candles)        — DSR(nTrials=1) + Monte-Carlo for one run.
 *  - validateOptimization(optSpec, candles) — runs the whole grid, then DSR
 *    deflated by the trial count, PBO via CSCV, Monte-Carlo on the selected
 *    config, and a parameter-sensitivity PLATEAU check.
 *
 * The verdict is the spec's trust gate: PASS needs DSR > 0.95, PBO < 0.5 and a
 * plateau (not a lone spike). PURE except for calling the pure backtest engine.
 */

import type {
	Candle,
	DeflatedSharpeReport,
	EquityPoint,
	OptimizationSpec,
	OptimizeParam,
	ParameterPlateauReport,
	StrategySpec,
	Trade,
	ValidationReport,
	ValidationVerdict
} from '$lib/types';
import { runBacktest } from '../engine/engine';
import { enumerateCombos, applyOverrides, rankCombos } from '../engine/optimize';
import { deflatedSharpe } from './deflated-sharpe';
import { buildPerformanceMatrix, computePBO } from './pbo';
import { shuffleTradeOrder, bootstrapReturns, randomizedEntryNull } from './monte-carlo';
import { sharpe, variance } from './stats';

/** Per-bar simple returns from an equity curve. */
export function equityToReturns(equity: EquityPoint[]): number[] {
	const out: number[] = [];
	for (let i = 1; i < equity.length; i++) {
		const prev = equity[i - 1].equity;
		out.push(prev !== 0 ? equity[i].equity / prev - 1 : 0);
	}
	return out;
}

/** Per-trade fractional returns (used by trade-order / bootstrap Monte-Carlo). */
export function extractTradeReturns(trades: Trade[]): number[] {
	return trades.map((t) => t.pnlPct);
}

/** Average holding period (bars) across trades; 1 when there are none. */
function avgHold(trades: Trade[]): number {
	if (trades.length === 0) return 1;
	return trades.reduce((s, t) => s + Math.max(0, t.barsHeld), 0) / trades.length;
}

function mapDsr(
	returns: number[],
	nTrials: number,
	varianceOfSharpes?: number
): DeflatedSharpeReport {
	const d = deflatedSharpe(returns, nTrials, varianceOfSharpes);
	return {
		sharpe: d.sharpe,
		psr: d.psr,
		expectedMaxSharpe: d.expectedMaxSharpe,
		dsr: d.dsr,
		nTrials: d.nTrials,
		nObservations: d.nObservations,
		skew: d.skew,
		kurtosis: d.kurtosis,
		pass: d.pass
	};
}

/** Index of `value` within a param's ascending value list (-1 if absent). */
function valueIndex(param: OptimizeParam, value: number): number {
	return [...param.values].sort((a, b) => a - b).indexOf(value);
}

/** Value vector of a combo as an index per param (for neighbour search). */
function comboVector(
	overrides: { indicatorId: string; param: string; value: number }[],
	params: OptimizeParam[]
): number[] {
	return params.map((p) => {
		const o = overrides.find((x) => x.indicatorId === p.indicatorId && x.param === p.param);
		return o ? valueIndex(p, o.value) : -1;
	});
}

/**
 * Parameter-sensitivity plateau: a real edge degrades gracefully as you step the
 * parameters; an overfit spike collapses. Compares the best config's metric to
 * the mean of its immediate grid neighbours (one param changed by one step).
 */
export function parameterPlateau(
	combos: { overrides: { indicatorId: string; param: string; value: number }[]; metric: number }[],
	params: OptimizeParam[],
	threshold = 0.7
): ParameterPlateauReport | null {
	if (combos.length < 2 || params.length === 0) return null;
	const best = [...combos].sort((a, b) => b.metric - a.metric)[0];
	const bestVec = comboVector(best.overrides, params);

	const neighbours = combos.filter((c) => {
		if (c === best) return false;
		const v = comboVector(c.overrides, params);
		let diffs = 0;
		let stepOk = true;
		for (let i = 0; i < bestVec.length; i++) {
			const d = Math.abs(v[i] - bestVec[i]);
			if (d !== 0) {
				diffs++;
				if (d !== 1) stepOk = false;
			}
		}
		return diffs === 1 && stepOk;
	});

	if (neighbours.length === 0) return null;
	const neighbourMean = neighbours.reduce((s, c) => s + c.metric, 0) / neighbours.length;
	// Robustness as a ratio for positive metrics; fall back to a bounded score.
	let robustness: number;
	if (best.metric > 0) robustness = Math.max(0, Math.min(1, neighbourMean / best.metric));
	else robustness = neighbourMean >= best.metric ? 1 : 0;

	return {
		isPlateau: robustness >= threshold,
		robustness,
		bestMetric: best.metric,
		neighbourMeanMetric: neighbourMean,
		neighboursChecked: neighbours.length
	};
}

function decideVerdict(report: Omit<ValidationReport, 'verdict' | 'notes'>): {
	verdict: ValidationVerdict;
	notes: string[];
} {
	const notes: string[] = [];
	const dsrPass = report.deflatedSharpe.pass;
	const pboPass = report.pbo === null ? true : report.pbo.pass;
	const plateauPass = report.plateau === null ? true : report.plateau.isPlateau;

	if (!dsrPass) notes.push(`Deflated Sharpe ${report.deflatedSharpe.dsr.toFixed(2)} ≤ 0.95.`);
	if (report.pbo && !report.pbo.pass) notes.push(`PBO ${report.pbo.pbo.toFixed(2)} ≥ 0.5.`);
	if (report.plateau && !report.plateau.isPlateau) {
		notes.push(
			`Best parameters look like a spike (robustness ${report.plateau.robustness.toFixed(2)}).`
		);
	}
	if (report.randomizedEntry && !report.randomizedEntry.pass) {
		notes.push('Strategy does not beat the randomized-entry null at the 95th percentile.');
	}

	let verdict: ValidationVerdict;
	if (dsrPass && pboPass && plateauPass) {
		verdict = 'pass';
		if (notes.length === 0) notes.push('Clears DSR, PBO and parameter-plateau gates.');
	} else if (!dsrPass && report.pbo && !report.pbo.pass) {
		verdict = 'fail';
	} else {
		verdict = 'warn';
	}
	return { verdict, notes };
}

export interface ValidateOptions {
	tradeOrderIterations?: number;
	bootstrapIterations?: number;
	randomizedEntryIterations?: number;
	seed?: number;
}

/** Validate a SINGLE strategy run (no parameter search). */
export function validateSingle(
	spec: StrategySpec,
	candlesByTicker: Record<string, Candle[]>,
	options: ValidateOptions = {}
): ValidationReport {
	const result = runBacktest(spec, candlesByTicker);
	const returns = equityToReturns(result.equityCurve);
	const tradeRets = extractTradeReturns(result.trades);
	const initial = spec.risk.initialCapital;
	const seed = options.seed ?? 1;

	const firstTicker = Object.keys(candlesByTicker)[0];
	const barRets = firstTicker ? equityToReturns(toEquityLike(candlesByTicker[firstTicker])) : [];
	const totalReturn = result.metrics.find((m) => m.id === 'totalReturn')?.value ?? 0;

	const base: Omit<ValidationReport, 'verdict' | 'notes'> = {
		selectedSharpe: sharpe(returns),
		nTrials: 1,
		nObservations: returns.length,
		deflatedSharpe: mapDsr(returns, 1),
		pbo: null,
		tradeOrderMonteCarlo:
			tradeRets.length > 1
				? shuffleTradeOrder(tradeRets, initial, options.tradeOrderIterations ?? 1000, seed)
				: null,
		bootstrap:
			tradeRets.length > 1
				? bootstrapReturns(tradeRets, initial, options.bootstrapIterations ?? 1000, seed + 1)
				: null,
		randomizedEntry:
			barRets.length > 5 && result.trades.length > 0
				? randomizedEntryNull(
						barRets,
						result.trades.length,
						avgHold(result.trades),
						totalReturn,
						options.randomizedEntryIterations ?? 1000,
						seed + 2
					)
				: null,
		plateau: null
	};
	const { verdict, notes } = decideVerdict(base);
	return { ...base, verdict, notes };
}

/** Treat a candle close series as an "equity" curve so equityToReturns works. */
function toEquityLike(candles: Candle[]): EquityPoint[] {
	return candles.map((c) => ({ t: c.t, equity: c.c }));
}

/** Validate an OPTIMIZATION: run the grid, then deflate, CSCV, MC and plateau. */
export function validateOptimization(
	spec: OptimizationSpec,
	candlesByTicker: Record<string, Candle[]>,
	maxCombos = 200,
	options: ValidateOptions = {}
): ValidationReport {
	const sortMetric = spec.sortMetric ?? 'totalReturn';
	const allCombos = enumerateCombos(spec.params).slice(0, maxCombos);
	const seed = options.seed ?? 1;

	const runs = allCombos.map((overrides) => {
		const result = runBacktest(applyOverrides(spec.base, overrides), candlesByTicker);
		return { overrides, result, returns: equityToReturns(result.equityCurve) };
	});

	// Rank to find the selected (best) config.
	const ranked = rankCombos(
		runs.map((r, i) => ({
			id: `c${i}`,
			overrides: r.overrides,
			totalReturn: metricOf(r.result.metrics, 'totalReturn'),
			sharpe: metricOf(r.result.metrics, 'sharpe'),
			maxDrawdown: metricOf(r.result.metrics, 'maxDrawdown'),
			winRate: metricOf(r.result.metrics, 'winRate'),
			totalTrades: metricOf(r.result.metrics, 'totalTrades'),
			metrics: r.result.metrics
		})),
		sortMetric
	);
	const bestId = ranked[0]?.id ?? 'c0';
	const bestRun = runs[Number(bestId.slice(1))] ?? runs[0];

	const selectedReturns = bestRun.returns;
	const trialSharpes = runs.map((r) => sharpe(r.returns));
	const varSharpes = trialSharpes.length > 1 ? variance(trialSharpes) : undefined;

	// PBO via CSCV, when there are enough trials and a usable block count.
	const len = selectedReturns.length;
	let pbo: ValidationReport['pbo'] = null;
	const blocks = Math.min(8, Math.floor(len / 20));
	const evenBlocks = blocks - (blocks % 2);
	if (runs.length >= 2 && evenBlocks >= 2) {
		const matrix = buildPerformanceMatrix(
			runs.map((r) => r.returns),
			evenBlocks
		);
		const p = computePBO(matrix);
		pbo = {
			pbo: p.pbo,
			nSplits: p.nSplits,
			nConfigs: p.nConfigs,
			nBlocks: p.nBlocks,
			pass: p.pass
		};
	}

	const initial = spec.base.risk.initialCapital;
	const tradeRets = extractTradeReturns(bestRun.result.trades);
	const firstTicker = Object.keys(candlesByTicker)[0];
	const barRets = firstTicker ? equityToReturns(toEquityLike(candlesByTicker[firstTicker])) : [];
	const totalReturn = metricOf(bestRun.result.metrics, 'totalReturn');

	const plateau = parameterPlateau(
		runs.map((r) => ({ overrides: r.overrides, metric: metricOf(r.result.metrics, sortMetric) })),
		spec.params
	);

	const base: Omit<ValidationReport, 'verdict' | 'notes'> = {
		selectedSharpe: sharpe(selectedReturns),
		nTrials: runs.length,
		nObservations: len,
		deflatedSharpe: mapDsr(selectedReturns, runs.length, varSharpes),
		pbo,
		tradeOrderMonteCarlo:
			tradeRets.length > 1
				? shuffleTradeOrder(tradeRets, initial, options.tradeOrderIterations ?? 1000, seed)
				: null,
		bootstrap:
			tradeRets.length > 1
				? bootstrapReturns(tradeRets, initial, options.bootstrapIterations ?? 1000, seed + 1)
				: null,
		randomizedEntry:
			barRets.length > 5 && bestRun.result.trades.length > 0
				? randomizedEntryNull(
						barRets,
						bestRun.result.trades.length,
						avgHold(bestRun.result.trades),
						totalReturn,
						options.randomizedEntryIterations ?? 1000,
						seed + 2
					)
				: null,
		plateau
	};
	const { verdict, notes } = decideVerdict(base);
	return { ...base, verdict, notes };
}

function metricOf(metrics: { id: string; value: number }[], id: string): number {
	const v = metrics.find((m) => m.id === id)?.value;
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
