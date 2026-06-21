<script lang="ts">
	import { goto } from '$app/navigation';
	import type { SavedStrategy, StrategySpec } from '$lib/types';
	import { untrack } from 'svelte';
	import { StrategiesStore } from '$lib/stores/strategies.svelte';
	import { Button, Callout, EmptyState, ErrorState, LoadingState } from '$lib/components/ui';
	import StrategyList from '$lib/components/strategies/StrategyList.svelte';
	import VersionsModal from '$lib/components/strategies/VersionsModal.svelte';
	import ImportStrategyDialog from '$lib/components/strategies/ImportStrategyDialog.svelte';
	import DeleteConfirm from '$lib/components/strategies/DeleteConfirm.svelte';
	import { Plus, UploadSimple, FolderOpen, Warning, X } from 'phosphor-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const store = new StrategiesStore();
	// Seed synchronously so SSR and the first client render show the list;
	// re-seed on navigation/invalidation when the load result changes.
	untrack(() => store.init(data.strategies));
	$effect(() => {
		store.init(data.strategies);
	});

	let loadError = $derived(data.error);

	// Modal state.
	let importOpen = $state(false);
	let versionsOpen = $state(false);
	let deleteOpen = $state(false);
	let active = $state<SavedStrategy | null>(null);

	async function handleDuplicate(id: string) {
		await store.duplicate(id);
	}

	function handleVersions(strategy: SavedStrategy) {
		active = strategy;
		versionsOpen = true;
	}

	function handleDelete(strategy: SavedStrategy) {
		active = strategy;
		deleteOpen = true;
	}

	async function confirmDelete(): Promise<boolean> {
		if (!active) return false;
		return store.remove(active.id);
	}

	async function handleImport(name: string, spec: StrategySpec): Promise<boolean> {
		const created = await store.create(name, spec);
		return created !== null;
	}

	async function retry() {
		loadError = null;
		await store.refresh();
	}
</script>

<svelte:head><title>Strategies · Strategy Tester</title></svelte:head>

<header class="page-head">
	<div class="titles">
		<h1>Strategies</h1>
		<p>Save, version, import and reopen your trading strategies.</p>
	</div>
	<div class="actions">
		<Button variant="secondary" onclick={() => (importOpen = true)}>
			{#snippet icon()}<UploadSimple size={16} />{/snippet}
			Import JSON
		</Button>
		<Button variant="primary" onclick={() => goto('/backtest')}>
			{#snippet icon()}<Plus size={16} weight="bold" />{/snippet}
			New strategy
		</Button>
	</div>
</header>

{#if store.error}
	<div class="banner">
		<Callout tone="danger" title="Action failed">
			{#snippet icon()}<Warning size={16} weight="fill" />{/snippet}
			<span class="banner-row">
				<span>{store.error}</span>
				<button
					type="button"
					class="dismiss"
					aria-label="Dismiss"
					onclick={() => store.clearError()}
				>
					<X size={14} />
				</button>
			</span>
		</Callout>
	</div>
{/if}

{#if loadError && store.list.length === 0}
	<ErrorState title="Couldn't load strategies" message={loadError} onRetry={retry} />
{:else if store.loading && store.list.length === 0}
	<LoadingState label="Loading strategies…" />
{:else if store.list.length === 0}
	<EmptyState
		title="No strategies yet"
		description="Build your first strategy in the visual builder, or import one from a JSON file."
	>
		{#snippet icon()}<FolderOpen size={32} weight="duotone" />{/snippet}
		{#snippet action()}
			<div class="empty-actions">
				<Button variant="primary" onclick={() => goto('/backtest')}>
					{#snippet icon()}<Plus size={16} weight="bold" />{/snippet}
					New strategy
				</Button>
				<Button variant="secondary" onclick={() => (importOpen = true)}>
					{#snippet icon()}<UploadSimple size={16} />{/snippet}
					Import JSON
				</Button>
			</div>
		{/snippet}
	</EmptyState>
{:else}
	<StrategyList
		strategies={store.list}
		onDuplicate={handleDuplicate}
		onVersions={handleVersions}
		onDelete={handleDelete}
	/>
{/if}

<ImportStrategyDialog
	bind:open={importOpen}
	onImport={handleImport}
	onClose={() => (importOpen = false)}
/>

{#if active}
	<VersionsModal
		bind:open={versionsOpen}
		strategy={active}
		onClose={() => (versionsOpen = false)}
	/>
	<DeleteConfirm
		bind:open={deleteOpen}
		name={active.name}
		onConfirm={confirmDelete}
		onClose={() => (deleteOpen = false)}
	/>
{/if}

<style>
	.page-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--sp-4);
		flex-wrap: wrap;
		margin-bottom: var(--sp-6);
	}
	.titles h1 {
		font-size: var(--fs-2xl);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.titles p {
		margin-top: var(--sp-1);
		font-size: var(--fs-base);
		color: var(--c-text-muted);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}
	.banner {
		margin-bottom: var(--sp-5);
	}
	.banner-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		width: 100%;
	}
	.dismiss {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.125rem;
		border: none;
		background: transparent;
		color: var(--c-text-muted);
		border-radius: var(--radius-sm);
		flex: none;
	}
	.dismiss:hover {
		color: var(--c-text);
	}
	.empty-actions {
		display: flex;
		gap: var(--sp-2);
		flex-wrap: wrap;
		justify-content: center;
	}
</style>
