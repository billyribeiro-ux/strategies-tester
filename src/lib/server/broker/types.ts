/**
 * Live-broker ABSTRACTION (spec §9).
 *
 * One order vocabulary, one interface — `BrokerAdapter`. A simulated
 * `PaperBroker` and a real broker (Alpaca / IBKR / Schwab) implement the SAME
 * interface, so the rest of the app (the paper/forward bridge in
 * `$lib/server/paper`) talks to a broker WITHOUT knowing whether execution is
 * simulated or live. No logic fork between backtest, paper, and live.
 *
 * `TradeSide` is REUSED verbatim from the result contract (`$lib/types`) — the
 * exact side vocabulary the engine and the forward bridge already speak — so
 * there is zero contract drift.
 */

import type { TradeSide } from '$lib/types';

/**
 * An order placed with a broker. The shape mirrors the engine's order model
 * (spec §9): a side, a quantity, and a type whose `limitPrice` / `stopPrice`
 * encode the trigger. `submittedAt` is an ISO timestamp the caller supplies —
 * the broker never reads the clock itself (determinism).
 */
export interface BrokerOrder {
	id: string;
	symbol: string;
	side: TradeSide;
	qty: number;
	type: 'market' | 'limit' | 'stop';
	limitPrice?: number;
	stopPrice?: number;
	submittedAt: string;
}

/** Lifecycle status of a submitted order. */
export type OrderStatus = 'pending' | 'filled' | 'rejected' | 'canceled';

/**
 * A realized fill. `price` is the execution price (already the reference/mark a
 * real broker would report); `commission` is the fee charged on the fill.
 * `filledAt` is an ISO timestamp supplied by the caller.
 */
export interface BrokerFill {
	orderId: string;
	symbol: string;
	side: TradeSide;
	qty: number;
	price: number;
	filledAt: string;
	commission: number;
}

/** A net position at the broker. `qty` > 0 = long, `qty` < 0 = short. */
export interface BrokerPosition {
	symbol: string;
	qty: number;
	avgPrice: number;
}

/**
 * Account snapshot. `equity = cash + Σ position marked at last known price`
 * (longs add market value, shorts subtract the cost to buy back).
 */
export interface BrokerAccount {
	cash: number;
	equity: number;
	positions: BrokerPosition[];
}

/**
 * THE BROKER CONTRACT. Every broker — simulated or live — implements this and
 * only this. The app is broker-agnostic: swap a `PaperBroker` for an
 * `AlpacaBroker` and nothing upstream changes.
 *
 * Note on `submitOrder`'s `markPrice` argument: it is the SIMULATION reference
 * price (the current/last price the order is resolved against). A real broker
 * ignores it — the venue determines the fill — but it is part of the signature
 * so the deterministic `PaperBroker` can resolve fills without a clock or a
 * live quote feed. Implementations document their own handling.
 */
export interface BrokerAdapter {
	/** Human-readable adapter name, e.g. `'paper'` or `'alpaca'`. */
	name: string;
	/**
	 * Submit an order. `markPrice` is the reference price used to resolve the
	 * fill in simulation (required by `PaperBroker` for market orders; used to
	 * test limit/stop triggers). Live brokers may ignore it.
	 */
	submitOrder(
		o: BrokerOrder,
		markPrice?: number
	): Promise<{ status: OrderStatus; fill?: BrokerFill; reason?: string }>;
	cancelOrder(id: string): Promise<{ ok: boolean }>;
	getAccount(): Promise<BrokerAccount>;
	getPositions(): Promise<BrokerPosition[]>;
}
