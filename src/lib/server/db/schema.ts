/**
 * Drizzle schema (SQLite). Storage contract for strategies, their version
 * history, backtest runs, and an OHLC cache that shields the FMP rate limit.
 *
 * Specs and results are stored as JSON text columns (they are validated at the
 * API boundary with zod). Summary columns on `runs` exist so listings don't
 * have to parse the full result blob.
 */

import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const strategies = sqliteTable('strategies', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	/** JSON-serialized StrategySpec. */
	spec: text('spec').notNull(),
	version: integer('version').notNull().default(1),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`(current_timestamp)`)
});

export const strategyVersions = sqliteTable(
	'strategy_versions',
	{
		id: text('id').primaryKey(),
		strategyId: text('strategy_id')
			.notNull()
			.references(() => strategies.id, { onDelete: 'cascade' }),
		version: integer('version').notNull(),
		name: text('name').notNull(),
		spec: text('spec').notNull(),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(current_timestamp)`)
	},
	(t) => [uniqueIndex('strategy_version_uq').on(t.strategyId, t.version)]
);

export const runs = sqliteTable(
	'runs',
	{
		runId: text('run_id').primaryKey(),
		strategyId: text('strategy_id'),
		strategyName: text('strategy_name').notNull(),
		/** JSON-serialized StrategySpec used for the run. */
		spec: text('spec').notNull(),
		/** JSON-serialized BacktestResult. */
		result: text('result').notNull(),
		totalReturn: real('total_return').notNull().default(0),
		sharpe: real('sharpe').notNull().default(0),
		maxDrawdown: real('max_drawdown').notNull().default(0),
		totalTrades: integer('total_trades').notNull().default(0),
		computedAt: text('computed_at')
			.notNull()
			.default(sql`(current_timestamp)`)
	},
	(t) => [index('runs_strategy_idx').on(t.strategyId)]
);

export const candleCache = sqliteTable(
	'candle_cache',
	{
		id: text('id').primaryKey(),
		symbol: text('symbol').notNull(),
		timeframe: text('timeframe').notNull(),
		fromDate: text('from_date').notNull(),
		toDate: text('to_date').notNull(),
		/** JSON-serialized Candle[]. */
		data: text('data').notNull(),
		fetchedAt: text('fetched_at')
			.notNull()
			.default(sql`(current_timestamp)`)
	},
	(t) => [uniqueIndex('candle_cache_uq').on(t.symbol, t.timeframe, t.fromDate, t.toDate)]
);

export type StrategyRow = typeof strategies.$inferSelect;
export type StrategyVersionRow = typeof strategyVersions.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type CandleCacheRow = typeof candleCache.$inferSelect;
