<script lang="ts">
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { Button, EmptyState, Panel } from '$lib/components/ui';
	import { Function, Plus } from 'phosphor-svelte';
	import IndicatorEditor from './IndicatorEditor.svelte';
	import IndicatorPicker from './IndicatorPicker.svelte';

	interface Props {
		store: StrategyStore;
	}

	let { store }: Props = $props();

	let pickerOpen = $state(false);
</script>

<Panel title="Indicators" description="Declare each indicator once, then reference it in your rules.">
	{#snippet icon()}<Function size={18} />{/snippet}
	{#snippet actions()}
		<Button size="sm" variant="primary" onclick={() => (pickerOpen = true)}>
			{#snippet icon()}<Plus size={14} weight="bold" />{/snippet}
			Add indicator
		</Button>
	{/snippet}

	{#if store.spec.indicators.length === 0}
		<EmptyState
			title="No indicators yet"
			description="Add an indicator to use it in your entry and exit conditions or risk stops."
			compact
		>
			{#snippet icon()}<Function size={28} />{/snippet}
			{#snippet action()}
				<Button size="sm" variant="secondary" onclick={() => (pickerOpen = true)}>
					{#snippet icon()}<Plus size={14} weight="bold" />{/snippet}
					Add indicator
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="list">
			{#each store.spec.indicators as instance (instance.id)}
				<IndicatorEditor {store} {instance} />
			{/each}
		</div>
	{/if}
</Panel>

<IndicatorPicker {store} bind:open={pickerOpen} onclose={() => (pickerOpen = false)} />

<style>
	.list {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-3);
	}

	@media (min-width: 80rem) {
		.list {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
