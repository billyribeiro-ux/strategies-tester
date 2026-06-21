<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { SavedStrategy } from '$lib/types';
	import { exportSpecJSON } from '$lib/spec/serialize';
	import { formatDateTime } from '$lib/utils/format';
	import { Card, Badge, Button, IconButton } from '$lib/components/ui';
	import {
		ArrowRight,
		Copy,
		ClockCounterClockwise,
		DownloadSimple,
		Trash,
		ChartBar,
		Clock
	} from 'phosphor-svelte';

	interface Props {
		strategy: SavedStrategy;
		/** Duplicate this strategy; resolves when done. */
		onDuplicate: (id: string) => Promise<void>;
		onVersions: (strategy: SavedStrategy) => void;
		onDelete: (strategy: SavedStrategy) => void;
	}

	let { strategy, onDuplicate, onVersions, onDelete }: Props = $props();

	let duplicating = $state(false);

	let tickers = $derived(strategy.spec.universe.tickers);
	let tickerSummary = $derived(
		tickers.length === 0
			? 'No tickers'
			: tickers.length <= 3
				? tickers.join(', ')
				: `${tickers.slice(0, 3).join(', ')} +${tickers.length - 3}`
	);
	let timeframe = $derived(strategy.spec.universe.timeframe);

	function open() {
		void goto(`/backtest?strategyId=${encodeURIComponent(strategy.id)}`);
	}

	async function duplicate() {
		duplicating = true;
		await onDuplicate(strategy.id);
		duplicating = false;
	}

	function exportJSON() {
		if (!browser) return;
		const json = exportSpecJSON(strategy.spec);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${strategy.name || 'strategy'}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<Card>
	<article class="card">
		<header class="head">
			<div class="title-row">
				<h3 class="name" title={strategy.name}>{strategy.name || 'Untitled strategy'}</h3>
				<Badge tone="primary" size="sm">v{strategy.version}</Badge>
			</div>
			<dl class="summary">
				<div class="item">
					<dt class="sr-only">Tickers and timeframe</dt>
					<dd>
						<span class="icon"><ChartBar size={14} /></span>
						<span class="value">{tickerSummary}</span>
						<span class="sep" aria-hidden="true">·</span>
						<Badge tone="neutral" size="sm">{timeframe}</Badge>
					</dd>
				</div>
				<div class="item">
					<dt class="sr-only">Last updated</dt>
					<dd>
						<span class="icon"><Clock size={14} /></span>
						<span class="value muted">Updated {formatDateTime(strategy.updatedAt)}</span>
					</dd>
				</div>
			</dl>
		</header>

		<footer class="actions">
			<Button size="sm" variant="primary" onclick={open}>
				{#snippet icon()}<ArrowRight size={15} weight="bold" />{/snippet}
				Open
			</Button>
			<Button size="sm" variant="ghost" loading={duplicating} onclick={duplicate}>
				{#snippet icon()}<Copy size={15} />{/snippet}
				Duplicate
			</Button>
			<div class="icon-actions">
				<IconButton label="Version history" size="sm" onclick={() => onVersions(strategy)}>
					<ClockCounterClockwise size={16} />
				</IconButton>
				<IconButton label="Export JSON" size="sm" onclick={exportJSON}>
					<DownloadSimple size={16} />
				</IconButton>
				<IconButton
					label="Delete strategy"
					variant="danger"
					size="sm"
					onclick={() => onDelete(strategy)}
				>
					<Trash size={16} />
				</IconButton>
			</div>
		</footer>
	</article>
</Card>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		height: 100%;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		justify-content: space-between;
	}
	.name {
		font-size: var(--fs-md);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.summary {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		margin: 0;
	}
	.item dd {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--c-text);
	}
	.icon {
		display: inline-flex;
		color: var(--c-text-faint);
		flex: none;
	}
	.value {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.value.muted {
		color: var(--c-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.sep {
		color: var(--c-text-faint);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		flex-wrap: wrap;
		margin-top: auto;
		padding-top: var(--sp-2);
		border-top: 1px solid var(--c-border);
	}
	.icon-actions {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		margin-left: auto;
	}
</style>
