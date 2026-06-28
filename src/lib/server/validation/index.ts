/**
 * The anti-overfit / validation suite (spec §6). Pure, deterministic, dependency
 * -free statistics: Deflated Sharpe, PBO via CSCV, purged combinatorial CV, and
 * seeded Monte-Carlo robustness tests. Nothing here touches the network or DB.
 */
export * from './stats';
export * from './rng';
export * from './deflated-sharpe';
export * from './pbo';
export * from './cpcv';
export * from './monte-carlo';
