<script lang="ts">
	import {
		DownloadSimple,
		FileCsv,
		FileXls,
		BracketsCurly,
		CaretDown,
		SpinnerGap
	} from 'phosphor-svelte';
	import type { BacktestResult, Trade } from '$lib/types';
	import { Button } from '$lib/components/ui';
	import { buildFilename, exportCsv, exportXlsx, exportResultJson } from '$lib/export';

	interface Props {
		result: BacktestResult;
		/** Trades currently shown (filtered + sorted) — exports respect these. */
		trades: Trade[];
	}
	let { result, trades }: Props = $props();

	let open = $state(false);
	let xlsxBusy = $state(false);
	let error = $state<string | null>(null);

	const disabled = $derived(trades.length === 0);
	const uid = $props.id();

	function close() {
		open = false;
	}

	/** Close the menu on an outside pointer press or the Escape key. */
	function menu(node: HTMLElement) {
		function onPointerDown(event: PointerEvent) {
			if (open && !node.contains(event.target as Node)) close();
		}
		function onKeyDown(event: KeyboardEvent) {
			if (open && event.key === 'Escape') {
				close();
				node.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
			}
		}
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown);
		};
	}

	function onCsv() {
		error = null;
		close();
		try {
			exportCsv(trades, buildFilename(result.spec, 'csv'));
		} catch (e) {
			error = e instanceof Error ? e.message : 'CSV export failed.';
		}
	}

	async function onXlsx() {
		if (xlsxBusy) return;
		error = null;
		close();
		xlsxBusy = true;
		try {
			await exportXlsx(result, buildFilename(result.spec, 'xlsx'));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Excel export failed.';
		} finally {
			xlsxBusy = false;
		}
	}

	function onJson() {
		error = null;
		close();
		try {
			exportResultJson(result, trades, buildFilename(result.spec, 'json'));
		} catch (e) {
			error = e instanceof Error ? e.message : 'JSON export failed.';
		}
	}
</script>

<div class="toolbar">
	<span class="count" aria-live="polite">
		<DownloadSimple size={15} />
		{trades.length} trade{trades.length === 1 ? '' : 's'} ready to export
	</span>

	<div class="menu" {@attach menu}>
		<Button
			variant="primary"
			size="sm"
			loading={xlsxBusy}
			{disabled}
			aria-haspopup="menu"
			aria-expanded={open}
			aria-controls="{uid}-menu"
			onclick={() => (open = !open)}
		>
			{#snippet icon()}
				{#if xlsxBusy}<SpinnerGap size={16} />{:else}<DownloadSimple size={16} />{/if}
			{/snippet}
			Export
			<CaretDown class="caret" size={13} weight="bold" />
		</Button>

		{#if open}
			<div class="dropdown" role="menu" id="{uid}-menu" aria-label="Export format">
				<button type="button" role="menuitem" class="item" onclick={onCsv}>
					<FileCsv size={17} />
					<span class="lines">
						<span class="t">CSV</span>
						<span class="s">Trade ledger (current view)</span>
					</span>
				</button>
				<button type="button" role="menuitem" class="item" onclick={onXlsx}>
					<FileXls size={17} />
					<span class="lines">
						<span class="t">Excel</span>
						<span class="s">Workbook: summary, trades & series</span>
					</span>
				</button>
				<button type="button" role="menuitem" class="item" onclick={onJson}>
					<BracketsCurly size={17} />
					<span class="lines">
						<span class="t">JSON</span>
						<span class="s">Full result (spec + all data)</span>
					</span>
				</button>
			</div>
		{/if}
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
	.menu {
		position: relative;
	}
	.menu :global(.caret) {
		margin-left: var(--sp-1);
		opacity: 0.85;
	}

	.dropdown {
		position: absolute;
		top: calc(100% + var(--sp-1));
		right: 0;
		z-index: var(--z-dropdown);
		min-width: 15rem;
		padding: var(--sp-1);
		display: flex;
		flex-direction: column;
		gap: 1px;
		background: var(--c-surface);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lg);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-2) var(--sp-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--c-text);
		text-align: left;
		cursor: pointer;
	}
	.item:hover,
	.item:focus-visible {
		background: var(--c-surface-2);
		outline: none;
	}
	.item:focus-visible {
		box-shadow: var(--focus-ring);
	}
	.lines {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.lines .t {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.lines .s {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
	}
	.error {
		margin-top: var(--sp-2);
		text-align: right;
		font-size: var(--fs-sm);
		color: var(--c-danger);
	}
</style>
