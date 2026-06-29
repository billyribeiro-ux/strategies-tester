/**
 * PaperBroker — an in-memory, DETERMINISTIC simulated broker (spec §9).
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * A REAL broker (Alpaca / IBKR / Schwab) implements the SAME `BrokerAdapter`
 * interface as this class. Because the whole app talks only to `BrokerAdapter`,
 * the paper/forward bridge (`$lib/server/paper`) is broker-agnostic: there is
 * NO logic fork between backtest, paper, and live execution — you swap the
 * adapter, not the code that drives it. This class is the simulated default and
 * the reference for what a live adapter must reproduce.
 *
 * ── Simulation / fill contract ─────────────────────────────────────────────
 * Fills need a reference price. To stay deterministic (no quote feed, no clock)
 * the caller PASSES that price in as `submitOrder(order, markPrice)`:
 *
 *   - `market`: REQUIRES `markPrice`; fills immediately at `markPrice`.
 *     Omitting it is a `rejected` (no reference to fill against).
 *   - `limit`:  needs `markPrice`. Fills only if the mark satisfies the limit
 *     (long: mark ≤ limitPrice; short: mark ≥ limitPrice), at `limitPrice`
 *     (price improvement is modelled as filling at the resting limit).
 *     Otherwise stays `pending` (the limit is live but unmet).
 *   - `stop`:   needs `markPrice`. Triggers only if the mark crosses the stop
 *     (long: mark ≥ stopPrice; short: mark ≤ stopPrice), then fills at
 *     `stopPrice`. Otherwise stays `pending`.
 *
 * A missing required price (e.g. a limit order with no `limitPrice`, or any
 * order with no `markPrice` where one is needed) is `rejected` with a reason.
 *
 * ── Cash / position accounting (mirrors the engine exactly) ─────────────────
 *   open/add long:  cash -= qty*price + commission
 *   open/add short: cash += qty*price - commission
 *   close long:     cash += qty*price - commission
 *   close short:    cash -= qty*price + commission
 *   equity = cash + Σ (long: qty*lastMark ; short: -qty*lastMark)
 *
 * Positions net by symbol (`qty` > 0 long, < 0 short); `avgPrice` is the
 * weighted-average entry of the OPEN exposure. Adding in the same direction
 * averages in; reducing keeps `avgPrice` and realizes cash; a fill larger than
 * the open qty flips the position and resets `avgPrice` to the fill price for
 * the residual.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 * No `Math.random`, no `Date.now`. Every timestamp is supplied by the caller
 * (`order.submittedAt` is reused as the fill time). Identical call sequences
 * produce identical state.
 */

import type {
	BrokerAccount,
	BrokerAdapter,
	BrokerFill,
	BrokerOrder,
	BrokerPosition,
	OrderStatus
} from './types';

export interface PaperBrokerConfig {
	startingCash: number;
	/** Commission charged per share filled (≥ 0). Defaults to 0. */
	commissionPerShare?: number;
}

/** Internal mutable position: signed qty (long > 0, short < 0). */
interface InternalPosition {
	symbol: string;
	qty: number;
	avgPrice: number;
}

export class PaperBroker implements BrokerAdapter {
	readonly name = 'paper';

	private cash: number;
	private readonly commissionPerShare: number;
	/** Net positions keyed by symbol; never holds zero-qty entries. */
	private readonly positions = new Map<string, InternalPosition>();
	/** Last mark seen per symbol, used to value open positions for equity. */
	private readonly lastMark = new Map<string, number>();

	constructor(config: PaperBrokerConfig) {
		this.cash = config.startingCash;
		this.commissionPerShare = config.commissionPerShare ?? 0;
	}

	async submitOrder(
		o: BrokerOrder,
		markPrice?: number
	): Promise<{ status: OrderStatus; fill?: BrokerFill; reason?: string }> {
		if (o.qty <= 0 || !Number.isFinite(o.qty)) {
			return { status: 'rejected', reason: 'qty must be a positive number' };
		}

		const resolved = this.resolveFillPrice(o, markPrice);
		if (resolved.status !== 'fill') {
			return { status: resolved.status, reason: resolved.reason };
		}

		const fillPrice = resolved.price;
		const commission = this.commissionPerShare * o.qty;

		// Mark the symbol at the fill price so equity reflects the latest known price.
		this.lastMark.set(o.symbol, fillPrice);

		this.applyFill(o, fillPrice, commission);

		const fill: BrokerFill = {
			orderId: o.id,
			symbol: o.symbol,
			side: o.side,
			qty: o.qty,
			price: fillPrice,
			filledAt: o.submittedAt,
			commission
		};
		return { status: 'filled', fill };
	}

	/**
	 * Cancel is a no-op for resolved orders: this broker fills or rejects
	 * synchronously, so there is no resting order book to cancel from. `ok` is
	 * always true so callers can treat cancellation uniformly across adapters; a
	 * live adapter would look `id` up in its open-order book.
	 */
	async cancelOrder(id: string): Promise<{ ok: boolean }> {
		// No resting book; the id resolves to nothing to cancel. Touch it so the
		// signature stays honest and matches what a live adapter receives.
		void id;
		return { ok: true };
	}

	async getAccount(): Promise<BrokerAccount> {
		return {
			cash: this.cash,
			equity: this.computeEquity(),
			positions: this.snapshotPositions()
		};
	}

	async getPositions(): Promise<BrokerPosition[]> {
		return this.snapshotPositions();
	}

	// -------------------------------------------------------------------------
	// Fill resolution (the simulation contract)
	// -------------------------------------------------------------------------

	private resolveFillPrice(
		o: BrokerOrder,
		markPrice?: number
	): { status: 'fill'; price: number } | { status: 'pending' | 'rejected'; reason: string } {
		if (o.type === 'market') {
			if (markPrice === undefined) {
				return { status: 'rejected', reason: 'market order requires a markPrice' };
			}
			return { status: 'fill', price: markPrice };
		}

		if (o.type === 'limit') {
			if (o.limitPrice === undefined) {
				return { status: 'rejected', reason: 'limit order requires limitPrice' };
			}
			if (markPrice === undefined) {
				return { status: 'rejected', reason: 'limit order requires a markPrice to evaluate' };
			}
			// Long fills at/below the limit; short fills at/above it.
			const satisfied = o.side === 'long' ? markPrice <= o.limitPrice : markPrice >= o.limitPrice;
			return satisfied
				? { status: 'fill', price: o.limitPrice }
				: { status: 'pending', reason: 'limit not satisfied by mark' };
		}

		// stop
		if (o.stopPrice === undefined) {
			return { status: 'rejected', reason: 'stop order requires stopPrice' };
		}
		if (markPrice === undefined) {
			return { status: 'rejected', reason: 'stop order requires a markPrice to evaluate' };
		}
		// Long stop triggers when price rises to/through it; short stop when it falls.
		const triggered = o.side === 'long' ? markPrice >= o.stopPrice : markPrice <= o.stopPrice;
		return triggered
			? { status: 'fill', price: o.stopPrice }
			: { status: 'pending', reason: 'stop not triggered by mark' };
	}

	// -------------------------------------------------------------------------
	// Cash + position accounting (mirrors the engine)
	// -------------------------------------------------------------------------

	/**
	 * Apply a fill to cash and the net position. `side === 'long'` BUYS `qty`
	 * (signed +qty), `side === 'short'` SELLS `qty` (signed -qty). The same path
	 * handles opening, averaging in, reducing, closing, and flipping.
	 */
	private applyFill(o: BrokerOrder, price: number, commission: number): void {
		const signedDelta = o.side === 'long' ? o.qty : -o.qty;

		// Cash: a BUY pays out (cost + fee), a SELL takes in (proceeds - fee).
		// For longs this is open/add; for closing a short the buy still pays out —
		// the sign of the cash flow is driven by the trade direction, not the
		// resulting position, which matches the engine's per-leg accounting.
		const notional = o.qty * price;
		this.cash += signedDelta > 0 ? -(notional + commission) : notional - commission;

		const existing = this.positions.get(o.symbol);
		const prevQty = existing?.qty ?? 0;
		const newQty = prevQty + signedDelta;

		if (newQty === 0) {
			// Fully closed.
			this.positions.delete(o.symbol);
			return;
		}

		const sameDirection = prevQty === 0 || Math.sign(prevQty) === Math.sign(newQty);
		const addingExposure = prevQty === 0 || Math.sign(signedDelta) === Math.sign(prevQty);

		let avgPrice: number;
		if (prevQty === 0) {
			// Brand new position.
			avgPrice = price;
		} else if (addingExposure) {
			// Averaging into existing exposure: weighted average of |qty|.
			const prevAbs = Math.abs(prevQty);
			const addAbs = o.qty;
			avgPrice =
				((existing as InternalPosition).avgPrice * prevAbs + price * addAbs) / (prevAbs + addAbs);
		} else if (sameDirection) {
			// Reducing exposure without crossing zero: avg entry unchanged.
			avgPrice = (existing as InternalPosition).avgPrice;
		} else {
			// Crossed zero (flipped direction): residual is a fresh position at fill.
			avgPrice = price;
		}

		this.positions.set(o.symbol, { symbol: o.symbol, qty: newQty, avgPrice });
	}

	private computeEquity(): number {
		let value = this.cash;
		for (const pos of this.positions.values()) {
			const mark = this.lastMark.get(pos.symbol);
			if (mark === undefined || !Number.isFinite(mark)) continue;
			// Long adds market value; short subtracts cost to buy back. pos.qty is
			// signed, so qty*mark already carries the right sign for both.
			value += pos.qty * mark;
		}
		return value;
	}

	private snapshotPositions(): BrokerPosition[] {
		return [...this.positions.values()].map((p) => ({
			symbol: p.symbol,
			qty: p.qty,
			avgPrice: p.avgPrice
		}));
	}
}
