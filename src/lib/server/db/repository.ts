/**
 * Persistence repository — the only module that talks to drizzle for the API
 * routes. It serializes/deserializes the JSON `spec` and `result` columns and
 * maps rows to domain objects (`SavedStrategy`, `BacktestResult`, `RunSummary`),
 * so routes never touch raw rows or JSON.
 *
 * better-sqlite3 is synchronous; these functions are therefore synchronous.
 */

import { desc, eq } from 'drizzle-orm';
import type {
	BacktestResult,
	MetricValue,
	RunSummary,
	SavedStrategy,
	StrategySpec
} from '$lib/types';
import { db } from '.';
import {
	runs,
	settings,
	strategies,
	strategyVersions,
	type RunRow,
	type StrategyRow,
	type StrategyVersionRow
} from './schema';
import { createId, newStrategyId } from '$lib/utils/id';
import { cloneSpec } from '$lib/spec/serialize';

// ---------------------------------------------------------------------------
// Row → domain mapping
// ---------------------------------------------------------------------------

function rowToStrategy(row: StrategyRow): SavedStrategy {
	return {
		id: row.id,
		name: row.name,
		spec: JSON.parse(row.spec) as StrategySpec,
		version: row.version,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function versionRowToStrategy(row: StrategyVersionRow): SavedStrategy {
	return {
		id: row.strategyId,
		name: row.name,
		spec: JSON.parse(row.spec) as StrategySpec,
		version: row.version,
		createdAt: row.createdAt,
		updatedAt: row.createdAt
	};
}

function metricValue(metrics: MetricValue[], id: string): number {
	return metrics.find((m) => m.id === id)?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export function listStrategies(): SavedStrategy[] {
	return db.select().from(strategies).orderBy(desc(strategies.updatedAt)).all().map(rowToStrategy);
}

export function getStrategy(id: string): SavedStrategy | null {
	const row = db.select().from(strategies).where(eq(strategies.id, id)).limit(1).all()[0];
	return row ? rowToStrategy(row) : null;
}

export interface CreateStrategyArgs {
	name: string;
	spec: StrategySpec;
}

export function createStrategy(args: CreateStrategyArgs): SavedStrategy {
	const id = newStrategyId();
	const now = new Date().toISOString();
	const spec: StrategySpec = { ...cloneSpec(args.spec), name: args.name };
	const specJson = JSON.stringify(spec);

	db.insert(strategies)
		.values({ id, name: args.name, spec: specJson, version: 1, createdAt: now, updatedAt: now })
		.run();
	db.insert(strategyVersions)
		.values({
			id: createId('ver'),
			strategyId: id,
			version: 1,
			name: args.name,
			spec: specJson,
			createdAt: now
		})
		.run();

	return { id, name: args.name, spec, version: 1, createdAt: now, updatedAt: now };
}

export interface UpdateStrategyArgs {
	name?: string;
	spec: StrategySpec;
	bumpVersion?: boolean;
}

export function updateStrategy(id: string, args: UpdateStrategyArgs): SavedStrategy | null {
	const existing = db.select().from(strategies).where(eq(strategies.id, id)).limit(1).all()[0];
	if (!existing) return null;

	const bump = args.bumpVersion ?? true;
	const name = args.name ?? existing.name;
	const version = bump ? existing.version + 1 : existing.version;
	const now = new Date().toISOString();
	const spec: StrategySpec = { ...cloneSpec(args.spec), name };
	const specJson = JSON.stringify(spec);

	db.update(strategies)
		.set({ name, spec: specJson, version, updatedAt: now })
		.where(eq(strategies.id, id))
		.run();

	if (bump) {
		db.insert(strategyVersions)
			.values({
				id: createId('ver'),
				strategyId: id,
				version,
				name,
				spec: specJson,
				createdAt: now
			})
			.onConflictDoNothing()
			.run();
	}

	return {
		id,
		name,
		spec,
		version,
		createdAt: existing.createdAt,
		updatedAt: now
	};
}

export function deleteStrategy(id: string): boolean {
	const result = db.delete(strategies).where(eq(strategies.id, id)).run();
	return result.changes > 0;
}

export function duplicateStrategy(id: string): SavedStrategy | null {
	const source = getStrategy(id);
	if (!source) return null;
	const name = `${source.name} (copy)`;
	return createStrategy({ name, spec: source.spec });
}

export function listVersions(id: string): SavedStrategy[] {
	return db
		.select()
		.from(strategyVersions)
		.where(eq(strategyVersions.strategyId, id))
		.orderBy(desc(strategyVersions.version))
		.all()
		.map(versionRowToStrategy);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface SaveRunArgs {
	result: BacktestResult;
	strategyId?: string | null;
}

export function saveRun(args: SaveRunArgs): BacktestResult {
	const { result } = args;
	db.insert(runs)
		.values({
			runId: result.runId,
			strategyId: args.strategyId ?? null,
			strategyName: result.spec.name,
			spec: JSON.stringify(result.spec),
			result: JSON.stringify(result),
			totalReturn: metricValue(result.metrics, 'totalReturn'),
			sharpe: metricValue(result.metrics, 'sharpe'),
			maxDrawdown: metricValue(result.metrics, 'maxDrawdown'),
			totalTrades: result.trades.length,
			computedAt: result.computedAt
		})
		.run();
	return result;
}

export function getRun(runId: string): BacktestResult | null {
	const row = db.select().from(runs).where(eq(runs.runId, runId)).limit(1).all()[0];
	if (!row) return null;
	return JSON.parse(row.result) as BacktestResult;
}

export function runSummary(row: RunRow): RunSummary {
	return {
		runId: row.runId,
		strategyName: row.strategyName,
		computedAt: row.computedAt,
		totalReturn: row.totalReturn,
		sharpe: row.sharpe,
		maxDrawdown: row.maxDrawdown,
		totalTrades: row.totalTrades
	};
}

// ---------------------------------------------------------------------------
// Settings (key/value)
// ---------------------------------------------------------------------------

/** Setting key under which the user-provided FMP API key is stored. */
export const FMP_KEY = 'fmpApiKey';

export function getSetting(key: string): string | null {
	const row = db.select().from(settings).where(eq(settings.key, key)).limit(1).all()[0];
	return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
	const now = new Date().toISOString();
	db.insert(settings)
		.values({ key, value, updatedAt: now })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
		.run();
}

export function deleteSetting(key: string): boolean {
	return db.delete(settings).where(eq(settings.key, key)).run().changes > 0;
}
