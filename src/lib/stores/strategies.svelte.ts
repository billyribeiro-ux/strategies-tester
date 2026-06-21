/**
 * Class-based rune store for the saved-strategy list.
 *
 * Holds the canonical client-side list of `SavedStrategy` records plus
 * `loading`/`error` UI flags. Every mutating method goes through the typed API
 * client (the single backend seam) and updates the local list optimistically,
 * rolling back and surfacing an `ApiError` message on failure.
 */

import type { SavedStrategy, StrategySpec } from '$lib/types';
import { createApiClient, ApiError } from '$lib/api/client';

function toMessage(err: unknown, fallback: string): string {
	if (err instanceof ApiError) return err.message;
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}

/** Newest-updated first, stable ordering for the list view. */
function byUpdatedDesc(a: SavedStrategy, b: SavedStrategy): number {
	return b.updatedAt.localeCompare(a.updatedAt);
}

export class StrategiesStore {
	#api = createApiClient();

	/** The canonical saved-strategy list, ordered newest-first. */
	list = $state<SavedStrategy[]>([]);
	/** True while a network mutation/refresh is in flight. */
	loading = $state(false);
	/** Last error message, or null. Cleared on the next successful action. */
	error = $state<string | null>(null);

	/** Seed the store from server-loaded data (idempotent). */
	init(initial: SavedStrategy[]): void {
		this.list = [...initial].sort(byUpdatedDesc);
		this.error = null;
	}

	/** Re-fetch the full list from the backend. */
	async refresh(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const next = await this.#api.listStrategies();
			this.list = [...next].sort(byUpdatedDesc);
		} catch (err) {
			this.error = toMessage(err, 'Could not load your strategies.');
		} finally {
			this.loading = false;
		}
	}

	/** Delete a strategy; optimistically removes it, restoring on failure. */
	async remove(id: string): Promise<boolean> {
		const snapshot = this.list;
		this.error = null;
		this.list = snapshot.filter((s) => s.id !== id);
		try {
			await this.#api.deleteStrategy(id);
			return true;
		} catch (err) {
			this.list = snapshot;
			this.error = toMessage(err, 'Could not delete the strategy.');
			return false;
		}
	}

	/** Duplicate a strategy; prepends the returned copy on success. */
	async duplicate(id: string): Promise<SavedStrategy | null> {
		this.error = null;
		try {
			const copy = await this.#api.duplicateStrategy(id);
			this.list = [copy, ...this.list].sort(byUpdatedDesc);
			return copy;
		} catch (err) {
			this.error = toMessage(err, 'Could not duplicate the strategy.');
			return null;
		}
	}

	/** Create a new strategy from a name + spec; prepends it on success. */
	async create(name: string, spec: StrategySpec): Promise<SavedStrategy | null> {
		this.error = null;
		try {
			const created = await this.#api.createStrategy({ name, spec });
			this.list = [created, ...this.list].sort(byUpdatedDesc);
			return created;
		} catch (err) {
			this.error = toMessage(err, 'Could not save the strategy.');
			return null;
		}
	}

	/** Clear the current error flag. */
	clearError(): void {
		this.error = null;
	}
}
