<script lang="ts">
	import type { SavedStrategy } from '$lib/types';
	import StrategyCard from './StrategyCard.svelte';

	interface Props {
		strategies: SavedStrategy[];
		onDuplicate: (id: string) => Promise<void>;
		onVersions: (strategy: SavedStrategy) => void;
		onDelete: (strategy: SavedStrategy) => void;
	}

	let { strategies, onDuplicate, onVersions, onDelete }: Props = $props();
</script>

<ul class="grid" aria-label="Saved strategies">
	{#each strategies as strategy (strategy.id)}
		<li>
			<StrategyCard {strategy} {onDuplicate} {onVersions} {onDelete} />
		</li>
	{/each}
</ul>

<style>
	.grid {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
		gap: var(--sp-4);
	}
	.grid > li {
		display: flex;
	}
	.grid > li > :global(*) {
		width: 100%;
	}

	@media (max-width: 40rem) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
