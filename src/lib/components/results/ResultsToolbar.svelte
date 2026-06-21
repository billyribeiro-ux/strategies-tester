<script lang="ts">
	import { DownloadSimple, FileCsv, FileXls, SpinnerGap } from 'phosphor-svelte';
	import type { BacktestResult, Trade } from '$lib/types';
	import { Button } from '$lib/components/ui';
	import { buildFilename, exportCsv, exportXlsx } from '$lib/export';

	interface Props {
		result: BacktestResult;
		/** Trades currently shown (filtered + sorted) — exports respect these. */
		trades: Trade[];
	}
	let { result, trades }: Props = $props();

	let xlsxBusy = $state(false);
	let error = $state<string | null>(null);

	function onCsv() {
		error = null;
		try {
			exportCsv(trades, buildFilename(result.spec, 'csv'));
		} catch (e) {
			error = e instanceof Error ? e.message : 'CSV export failed.';
		}
	}

	async function onXlsx() {
		if (xlsxBusy) return;
		error = null;
		xlsxBusy = true;
		try {
			await exportXlsx(result, buildFilename(result.spec, 'xlsx'));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Excel export failed.';
		} finally {
			xlsxBusy = false;
		}
	}
</script>

<div class="toolbar">
	<span class="count" aria-live="polite">
		<DownloadSimple size={15} />
		{trades.length} trade{trades.length === 1 ? '' : 's'} ready to export
	</span>
	<div class="actions">
		<Button variant="secondary" size="sm" onclick={onCsv} disabled={trades.length === 0}>
			{#snippet icon()}<FileCsv size={16} />{/snippet}
			Export CSV
		</Button>
		<Button
			variant="primary"
			size="sm"
			onclick={onXlsx}
			loading={xlsxBusy}
			disabled={trades.length === 0}
		>
			{#snippet icon()}
				{#if xlsxBusy}<SpinnerGap size={16} />{:else}<FileXls size={16} />{/if}
			{/snippet}
			Export Excel
		</Button>
	</div>
</div>

{#if error}
	<p class="error" role="alert">{error}</p>
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	.count {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		font-variant-numeric: tabular-nums;
		margin-right: auto;
	}
	.actions {
		display: flex;
		gap: var(--sp-2);
	}
	.error {
		margin-top: var(--sp-2);
		text-align: right;
		font-size: var(--fs-sm);
		color: var(--c-danger);
	}
</style>
