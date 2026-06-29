import { describe, it, expect } from 'vitest';
import { PaperBroker } from './paper-broker';
import type { BrokerAdapter, BrokerOrder } from './types';

// ---------------------------------------------------------------------------
// Helpers — deterministic order builder (timestamps are supplied, never clocked)
// ---------------------------------------------------------------------------

let seq = 0;
function order(
	partial: Partial<BrokerOrder> & Pick<BrokerOrder, 'side' | 'qty' | 'type'>
): BrokerOrder {
	seq += 1;
	return {
		id: partial.id ?? `o${seq}`,
		symbol: partial.symbol ?? 'AAPL',
		side: partial.side,
		qty: partial.qty,
		type: partial.type,
		limitPrice: partial.limitPrice,
		stopPrice: partial.stopPrice,
		submittedAt: partial.submittedAt ?? '2024-01-01T00:00:00.000Z'
	};
}

describe('PaperBroker — market fills + cash accounting', () => {
	it('implements the BrokerAdapter interface', () => {
		const b: BrokerAdapter = new PaperBroker({ startingCash: 10_000 });
		expect(b.name).toBe('paper');
		expect(typeof b.submitOrder).toBe('function');
		expect(typeof b.cancelOrder).toBe('function');
		expect(typeof b.getAccount).toBe('function');
		expect(typeof b.getPositions).toBe('function');
	});

	it('market buy fills, reduces cash, and creates a long position with avgPrice', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		const res = await b.submitOrder(order({ side: 'long', qty: 10, type: 'market' }), 100);

		expect(res.status).toBe('filled');
		expect(res.fill?.price).toBe(100);
		expect(res.fill?.qty).toBe(10);

		const acct = await b.getAccount();
		// 10_000 - 10*100 - 0 commission
		expect(acct.cash).toBe(9_000);
		expect(acct.positions).toEqual([{ symbol: 'AAPL', qty: 10, avgPrice: 100 }]);
	});

	it('a second buy averages into the position', async () => {
		const b = new PaperBroker({ startingCash: 100_000 });
		await b.submitOrder(order({ side: 'long', qty: 10, type: 'market' }), 100);
		await b.submitOrder(order({ side: 'long', qty: 30, type: 'market' }), 120);

		const pos = (await b.getPositions())[0];
		expect(pos.qty).toBe(40);
		// (10*100 + 30*120) / 40 = (1000 + 3600)/40 = 115
		expect(pos.avgPrice).toBe(115);

		const acct = await b.getAccount();
		// 100_000 - 1000 - 3600
		expect(acct.cash).toBe(95_400);
	});

	it('a sell realizes cash and reduces qty (avgPrice unchanged on a reduce)', async () => {
		const b = new PaperBroker({ startingCash: 100_000 });
		await b.submitOrder(order({ side: 'long', qty: 100, type: 'market' }), 50);
		// cash now 100_000 - 5000 = 95_000
		const sell = await b.submitOrder(order({ side: 'short', qty: 40, type: 'market' }), 60);

		expect(sell.status).toBe('filled');
		const pos = (await b.getPositions())[0];
		expect(pos.qty).toBe(60);
		expect(pos.avgPrice).toBe(50); // reducing keeps entry avg

		const acct = await b.getAccount();
		// 95_000 + 40*60 (proceeds) = 95_000 + 2400 = 97_400
		expect(acct.cash).toBe(97_400);
	});

	it('selling the whole position closes it (no zero-qty entry left)', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		await b.submitOrder(order({ side: 'long', qty: 10, type: 'market' }), 100);
		await b.submitOrder(order({ side: 'short', qty: 10, type: 'market' }), 110);

		const positions = await b.getPositions();
		expect(positions).toEqual([]);

		const acct = await b.getAccount();
		// 10_000 - 1000 + 1100 = 10_100
		expect(acct.cash).toBe(10_100);
		expect(acct.equity).toBe(10_100); // no open position
	});
});

describe('PaperBroker — shorts', () => {
	it('a short sale increases cash and creates a negative-qty position', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		const res = await b.submitOrder(order({ side: 'short', qty: 10, type: 'market' }), 100);

		expect(res.status).toBe('filled');
		const acct = await b.getAccount();
		// 10_000 + 10*100 proceeds = 11_000
		expect(acct.cash).toBe(11_000);
		expect(acct.positions).toEqual([{ symbol: 'AAPL', qty: -10, avgPrice: 100 }]);
	});

	it('covering a short pays cash and realizes the trade', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		await b.submitOrder(order({ side: 'short', qty: 10, type: 'market' }), 100); // cash 11_000
		await b.submitOrder(order({ side: 'long', qty: 10, type: 'market' }), 90); // buy back cheaper

		const acct = await b.getAccount();
		// 11_000 - 10*90 = 10_100 (profit 100)
		expect(acct.cash).toBe(10_100);
		expect(await b.getPositions()).toEqual([]);
	});
});

describe('PaperBroker — limit & stop fill semantics', () => {
	it('a long limit whose mark is above the limit stays pending', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		const res = await b.submitOrder(
			order({ side: 'long', qty: 5, type: 'limit', limitPrice: 100 }),
			105
		);
		expect(res.status).toBe('pending');
		expect(res.fill).toBeUndefined();
		expect(await b.getPositions()).toEqual([]);
		expect((await b.getAccount()).cash).toBe(10_000); // untouched
	});

	it('a long limit fills at the limit price when the mark satisfies it', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		const res = await b.submitOrder(
			order({ side: 'long', qty: 5, type: 'limit', limitPrice: 100 }),
			98
		);
		expect(res.status).toBe('filled');
		expect(res.fill?.price).toBe(100); // resting limit price, not the mark
		expect((await b.getAccount()).cash).toBe(10_000 - 500);
	});

	it('a long stop only triggers once the mark reaches the stop', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		const notYet = await b.submitOrder(
			order({ side: 'long', qty: 5, type: 'stop', stopPrice: 110 }),
			105
		);
		expect(notYet.status).toBe('pending');

		const triggered = await b.submitOrder(
			order({ side: 'long', qty: 5, type: 'stop', stopPrice: 110 }),
			112
		);
		expect(triggered.status).toBe('filled');
		expect(triggered.fill?.price).toBe(110);
	});

	it('rejects a market order with no markPrice and a limit order with no limitPrice', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		const noMark = await b.submitOrder(order({ side: 'long', qty: 5, type: 'market' }));
		expect(noMark.status).toBe('rejected');
		expect(noMark.reason).toMatch(/markPrice/);

		const noLimit = await b.submitOrder(order({ side: 'long', qty: 5, type: 'limit' }), 100);
		expect(noLimit.status).toBe('rejected');
		expect(noLimit.reason).toMatch(/limitPrice/);
	});

	it('rejects a non-positive quantity', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		const res = await b.submitOrder(order({ side: 'long', qty: 0, type: 'market' }), 100);
		expect(res.status).toBe('rejected');
	});
});

describe('PaperBroker — commission', () => {
	it('applies per-share commission to the fill and to cash', async () => {
		const b = new PaperBroker({ startingCash: 10_000, commissionPerShare: 0.01 });
		const res = await b.submitOrder(order({ side: 'long', qty: 100, type: 'market' }), 50);

		expect(res.fill?.commission).toBeCloseTo(1, 10); // 100 * 0.01
		const acct = await b.getAccount();
		// 10_000 - 100*50 - 1 = 4_999
		expect(acct.cash).toBeCloseTo(4_999, 10);
	});

	it('charges commission on both the open and the close legs', async () => {
		const b = new PaperBroker({ startingCash: 10_000, commissionPerShare: 0.05 });
		await b.submitOrder(order({ side: 'long', qty: 10, type: 'market' }), 100); // -1000 -0.5
		await b.submitOrder(order({ side: 'short', qty: 10, type: 'market' }), 100); // +1000 -0.5

		const acct = await b.getAccount();
		// 10_000 - 1000 - 0.5 + 1000 - 0.5 = 9_999
		expect(acct.cash).toBeCloseTo(9_999, 10);
	});
});

describe('PaperBroker — equity marking', () => {
	it('equity reflects the last mark on an open long', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		await b.submitOrder(order({ side: 'long', qty: 10, type: 'market' }), 100);
		// cash 9_000, position marked at 100 -> equity 10_000

		// A later limit fill at a higher price re-marks the symbol.
		await b.submitOrder(
			order({ side: 'long', qty: 0.0000001, type: 'limit', limitPrice: 120 }),
			121 // mark above limit for a long -> pending, no re-mark
		);
		let acct = await b.getAccount();
		expect(acct.equity).toBeCloseTo(10_000, 6); // still marked at 100

		// Now a fill that re-marks at 130.
		await b.submitOrder(order({ side: 'long', qty: 0.0001, type: 'market' }), 130);
		acct = await b.getAccount();
		// position ~10.0001 marked at 130, cash reduced by the tiny buy
		const pos = (await b.getPositions())[0];
		expect(pos.avgPrice).toBeGreaterThan(100);
		expect(acct.equity).toBeGreaterThan(10_000); // marked up to 130
	});

	it('equity on an open short subtracts the cost to buy back at the mark', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		await b.submitOrder(order({ side: 'short', qty: 10, type: 'market' }), 100);
		// cash 11_000, short marked at 100 -> equity 11_000 - 1000 = 10_000
		const acct = await b.getAccount();
		expect(acct.equity).toBe(10_000);
	});
});

describe('PaperBroker — flipping & determinism', () => {
	it('a sell larger than the open long flips to a short with a fresh avgPrice', async () => {
		const b = new PaperBroker({ startingCash: 100_000 });
		await b.submitOrder(order({ side: 'long', qty: 10, type: 'market' }), 100);
		await b.submitOrder(order({ side: 'short', qty: 25, type: 'market' }), 110);

		const pos = (await b.getPositions())[0];
		expect(pos.qty).toBe(-15); // 10 long closed, 15 short opened
		expect(pos.avgPrice).toBe(110); // residual short at the fill price
	});

	it('identical call sequences produce identical state (determinism)', async () => {
		async function run() {
			const b = new PaperBroker({ startingCash: 50_000, commissionPerShare: 0.02 });
			await b.submitOrder(order({ id: 'a', side: 'long', qty: 10, type: 'market' }), 100);
			await b.submitOrder(order({ id: 'b', side: 'long', qty: 20, type: 'market' }), 110);
			await b.submitOrder(order({ id: 'c', side: 'short', qty: 15, type: 'market' }), 120);
			await b.submitOrder(
				order({ id: 'd', side: 'short', qty: 5, type: 'limit', limitPrice: 130 }),
				125 // short limit needs mark >= 130 -> pending
			);
			return b.getAccount();
		}

		const first = await run();
		const second = await run();
		expect(first).toEqual(second);
		// And concrete: 15 left long at avg (10*100+20*110)/30 = 106.6667
		const pos = first.positions[0];
		expect(pos.qty).toBe(15);
		expect(pos.avgPrice).toBeCloseTo((10 * 100 + 20 * 110) / 30, 10);
	});

	it('cancelOrder returns ok (uniform cross-adapter behaviour)', async () => {
		const b = new PaperBroker({ startingCash: 10_000 });
		expect(await b.cancelOrder('nope')).toEqual({ ok: true });
	});
});
