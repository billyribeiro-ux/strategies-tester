<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { SavedStrategy } from '$lib/types';
	import { createApiClient, ApiError } from '$lib/api/client';
	import { exportSpecJSON } from '$lib/spec/serialize';
	import { formatDateTime } from '$lib/utils/format';
	import { Modal, Button, Badge, LoadingState, ErrorState, EmptyState } from '$lib/components/ui';
	import { ClockCounterClockwise, DownloadSimple, ArrowRight } from 'phosphor-svelte';

	interface Props {
		open?: boolean;
		/** The strategy whose version history we list. */
		strategy: SavedStrategy;
		onClose: () => void;
	}

	let { open = $bindable(false), strategy, onClose }: Props = $props();

	const api = createApiClient();

	let versions = $state<SavedStrategy[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let loadedFor = $state<string | null>(null);

	// Fetch versions whenever the modal opens for a (new) strategy.
	$effect(() => {
		if (open && loadedFor !== strategy.id) {
			void load();
		}
	});

	async function load() {
		loading = true;
		error = null;
		try {
			const result = await api.listVersions(strategy.id);
			versions = [...result].sort((a, b) => b.version - a.version);
			loadedFor = strategy.id;
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not load the version history.';
		} finally {
			loading = false;
		}
	}

	function download(version: SavedStrategy) {
		if (!browser) return;
		const json = exportSpecJSON(version.spec);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${version.name || 'strategy'}-v${version.version}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function openVersion(version: SavedStrategy) {
		onClose();
		void goto(`/backtest?strategyId=${encodeURIComponent(version.id)}&version=${version.version}`);
	}
</script>

<Modal bind:open title="Version history" size="md" onclose={onClose}>
	<p class="subtitle">{strategy.name}</p>

	{#if loading}
		<LoadingState label="Loading versions…" compact />
	{:else if error}
		<ErrorState title="Couldn't load versions" message={error} onRetry={load} />
	{:else if versions.length === 0}
		<EmptyState title="No versions yet" description="This strategy has no saved history." compact>
			{#snippet icon()}<ClockCounterClockwise size={28} />{/snippet}
		</EmptyState>
	{:else}
		<ul class="versions">
			{#each versions as version (version.id + ':' + version.version)}
				<li class="version">
					<div class="meta">
						<Badge tone="primary" size="sm">v{version.version}</Badge>
						<span class="date">{formatDateTime(version.updatedAt)}</span>
					</div>
					<div class="actions">
						<Button size="sm" variant="ghost" onclick={() => download(version)}>
							{#snippet icon()}<DownloadSimple size={15} />{/snippet}
							Export JSON
						</Button>
						<Button size="sm" variant="secondary" onclick={() => openVersion(version)}>
							{#snippet icon()}<ArrowRight size={15} />{/snippet}
							Open this version
						</Button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose}>Close</Button>
	{/snippet}
</Modal>

<style>
	.subtitle {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		margin-bottom: var(--sp-4);
	}
	.versions {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	.version {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		flex-wrap: wrap;
		padding: var(--sp-3);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		background: var(--c-surface-2);
	}
	.meta {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.date {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.actions {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}
</style>
