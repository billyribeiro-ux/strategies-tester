/**
 * Shared validation-report contract (spec §6) — imported by BOTH the server
 * (which computes it) and the client (which renders it). Plain numeric shapes so
 * the client never imports server-only statistics code.
 *
 * The headline gates: a trustworthy optimization shows DSR > 0.95, PBO < 0.5,
 * and a parameter PLATEAU (robust across neighbours, not a lone spike).
 */

export interface DeflatedSharpeReport {
	sharpe: number;
	psr: number;
	expectedMaxSharpe: number;
	dsr: number;
	nTrials: number;
	nObservations: number;
	skew: number;
	kurtosis: number;
	/** DSR > 0.95. */
	pass: boolean;
}

export interface PboReport {
	pbo: number;
	nSplits: number;
	nConfigs: number;
	nBlocks: number;
	/** PBO < 0.5. */
	pass: boolean;
}

export interface MonteCarloReport {
	iterations: number;
	observed: number;
	p05: number;
	p50: number;
	p95: number;
	observedRank: number;
}

export interface RandomizedEntryReport extends MonteCarloReport {
	/** Observed return beats the random-entry null at the 95th percentile. */
	pass: boolean;
	nullMean: number;
}

export interface ParameterPlateauReport {
	/** Neighbours of the best config retain a high fraction of its performance. */
	isPlateau: boolean;
	/** Mean(neighbour metric) / best metric, clamped to [0,1] for positive metrics. */
	robustness: number;
	bestMetric: number;
	neighbourMeanMetric: number;
	neighboursChecked: number;
}

export type ValidationVerdict = 'pass' | 'warn' | 'fail';

export interface ValidationReport {
	/** Per-period Sharpe of the selected strategy. */
	selectedSharpe: number;
	nTrials: number;
	nObservations: number;
	deflatedSharpe: DeflatedSharpeReport;
	/** Null when too few trials/blocks to run CSCV. */
	pbo: PboReport | null;
	tradeOrderMonteCarlo: MonteCarloReport | null;
	bootstrap: MonteCarloReport | null;
	randomizedEntry: RandomizedEntryReport | null;
	/** Null when there is no parameter grid (single config). */
	plateau: ParameterPlateauReport | null;
	verdict: ValidationVerdict;
	notes: string[];
}
