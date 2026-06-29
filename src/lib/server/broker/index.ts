/**
 * Live-broker abstraction (spec §9) — public surface.
 *
 * One order vocabulary, one `BrokerAdapter` interface. `PaperBroker` is the
 * deterministic simulated default; a real broker (Alpaca / IBKR / Schwab)
 * implements the SAME interface, so the app is broker-agnostic — no logic fork
 * between backtest, paper, and live. See `paper-broker.ts`.
 */

export type {
	BrokerOrder,
	OrderStatus,
	BrokerFill,
	BrokerPosition,
	BrokerAccount,
	BrokerAdapter
} from './types';

export { PaperBroker, type PaperBrokerConfig } from './paper-broker';
