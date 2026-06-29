/**
 * Paper / forward-testing bridge (spec §9) — public surface.
 *
 * Runs the SAME engine on the latest data so there is no logic fork between a
 * backtest and the "live" signal. See `forward.ts`.
 */

export {
	computeForwardState,
	divergence,
	type ForwardState,
	type ForwardTicker,
	type ForwardSignals,
	type ForwardOpenPosition,
	type Divergence
} from './forward';
