<script lang="ts">
	import type { IndicatorCapability } from '$lib/types';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { Modal, TextInput } from '$lib/components/ui';
	import { MagnifyingGlass, Plus } from 'phosphor-svelte';

	interface Props {
		store: StrategyStore;
		open: boolean;
		onclose: () => void;
		/** Called with the new instance id after an indicator is added. */
		onadd?: (id: string) => void;
	}

	let { store, open = $bindable(), onclose, onadd }: Props = $props();

	let query = $state('');

	const filtered = $derived.by((): IndicatorCapability[] => {
		const q = query.trim().toLowerCase();
		const all = store.capabilities.indicators;
		if (!q) return all;
		return all.filter(
			(c) =>
				c.label.toLowerCase().includes(q) ||
				c.type.toLowerCase().includes(q) ||
				(c.description?.toLowerCase().includes(q) ?? false)
		);
	});

	function pick(cap: IndicatorCapability) {
		const id = store.addIndicator(cap.type);
		query = '';
		if (id) onadd?.(id);
		onclose();
	}
</script>

<Modal bind:open title="Add indicator" size="md" {onclose}>
	<div class="picker">
		<div class="search">
			<span class="search-icon" aria-hidden="true"><MagnifyingGlass size={16} /></span>
			<div class="search-input">
				<TextInput
					placeholder="Search indicators…"
					bind:value={query}
					aria-label="Search indicators"
				/>
			</div>
		</div>

		{#if filtered.length === 0}
			<p class="none">No indicators match “{query}”.</p>
		{:else}
			<ul class="list">
				{#each filtered as cap (cap.type)}
					<li>
						<button type="button" class="item" onclick={() => pick(cap)}>
							<span class="item-text">
								<span class="item-label">{cap.label}</span>
								{#if cap.description}<span class="item-desc">{cap.description}</span>{/if}
							</span>
							<span class="item-add" aria-hidden="true"><Plus size={16} weight="bold" /></span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Modal>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.search {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}
	.search-icon {
		color: var(--c-text-muted);
		flex: none;
	}
	.search-input {
		flex: 1 1 auto;
	}
	.none {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		padding: var(--sp-4) 0;
		text-align: center;
	}
	.list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		max-height: 50vh;
		overflow-y: auto;
	}
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		width: 100%;
		text-align: left;
		padding: var(--sp-3);
		background: var(--c-surface-2);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		color: var(--c-text);
		transition:
			background var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}
	.item:hover {
		background: var(--c-surface-3);
		border-color: var(--c-border-strong);
	}
	.item-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.item-label {
		font-weight: 600;
	}
	.item-desc {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
	}
	.item-add {
		color: var(--c-primary);
		flex: none;
	}
</style>
