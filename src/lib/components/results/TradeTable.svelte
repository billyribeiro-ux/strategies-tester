<script lang="ts">
	import { Funnel, FunnelX, CaretUp, CaretDown } from 'phosphor-svelte';
	import type { Trade } from '$lib/types';
	import { LEDGER_COLUMNS, computeTotals, type LedgerColumn } from '$lib/export/ledger';
	import {
		formatInt,
		formatPercent,
		formatRatio,
		formatRMultiple,
		formatSignedCurrency
	} from '$lib/utils/format';
	import { EmptyState, IconButton, Select } from '$lib/components/ui';

	interface Props {
		trades: Trade[];
		/** Notified whenever the filtered + sorted view changes (for export). */
		onfilteredchange?: (trades: Trade[]) => void;
	}
	let { trades, onfilteredchange }: Props = $props();

	type SortDir = 'asc' | 'desc' | 'none';
	let sortKey = $state<string | null>(null);
	let sortDir = $state<SortDir>('none');

	const isNumeric = (c: LedgerColumn) =>
		c.type === 'number' || c.type === 'currency' || c.type === 'percent' || c.type === 'r';

	let filtersOpen = $state(false);
	// Per-column filter state, pre-seeded so every key is a defined string.
	// Text/enum columns use a contains/equals string; numeric columns use min/max.
	let textFilters = $state<Record<string, string>>(
		Object.fromEntries(LEDGER_COLUMNS.filter((c) => !isNumeric(c)).map((c) => [c.key, '']))
	);
	let numFilters = $state<Record<string, { min: string; max: string }>>(
		Object.fromEntries(LEDGER_COLUMNS.filter(isNumeric).map((c) => [c.key, { min: '', max: '' }]))
	);

	function cycleSort(key: string) {
		if (sortKey !== key) {
			sortKey = key;
			sortDir = 'asc';
		} else if (sortDir === 'asc') {
			sortDir = 'desc';
		} else if (sortDir === 'desc') {
			sortDir = 'none';
			sortKey = null;
		} else {
			sortDir = 'asc';
		}
	}

	function clearFilters() {
		textFilters = Object.fromEntries(
			LEDGER_COLUMNS.filter((c) => !isNumeric(c)).map((c) => [c.key, ''])
		);
		numFilters = Object.fromEntries(
			LEDGER_COLUMNS.filter(isNumeric).map((c) => [c.key, { min: '', max: '' }])
		);
	}

	const hasActiveFilters = $derived(
		Object.values(textFilters).some((v) => v.trim() !== '') ||
			Object.values(numFilters).some((r) => r.min.trim() !== '' || r.max.trim() !== '')
	);

	// Index the original trades so filtering by value still yields real Trade refs.
	const indexed = $derived(trades.map((t, i) => ({ t, i })));

	const filtered = $derived(
		indexed.filter(({ t, i }) =>
			LEDGER_COLUMNS.every((col) => {
				if (isNumeric(col)) {
					const range = numFilters[col.key];
					const v = col.value(t, i) as number;
					const min = range.min.trim() === '' ? null : Number(range.min);
					const max = range.max.trim() === '' ? null : Number(range.max);
					if (min !== null && Number.isFinite(min) && !(v >= min)) return false;
					if (max !== null && Number.isFinite(max) && !(v <= max)) return false;
					return true;
				}
				const needle = textFilters[col.key];
				if (needle.trim() === '') return true;
				const hay = String(col.value(t, i)).toLowerCase();
				return hay.includes(needle.trim().toLowerCase());
			})
		)
	);

	const filteredSorted = $derived(
		(() => {
			const rows = filtered.slice();
			if (sortKey && sortDir !== 'none') {
				const col = LEDGER_COLUMNS.find((c) => c.key === sortKey);
				if (col) {
					const factor = sortDir === 'asc' ? 1 : -1;
					rows.sort((a, b) => {
						const va = col.value(a.t, a.i);
						const vb = col.value(b.t, b.i);
						let cmp: number;
						if (typeof va === 'number' && typeof vb === 'number') {
							// Push NaN to the end regardless of direction.
							const na = Number.isNaN(va);
							const nb = Number.isNaN(vb);
							if (na && nb) cmp = 0;
							else if (na) return 1;
							else if (nb) return -1;
							else cmp = va - vb;
						} else {
							cmp = String(va).localeCompare(String(vb));
						}
						return cmp * factor;
					});
				}
			}
			return rows;
		})()
	);

	// Expose the current filtered+sorted trades to the parent for export.
	const exportTrades = $derived(filteredSorted.map((r) => r.t));
	$effect(() => {
		onfilteredchange?.(exportTrades);
	});

	const totals = $derived(computeTotals(exportTrades));

	function ariaSort(key: string): 'ascending' | 'descending' | 'none' {
		if (sortKey !== key || sortDir === 'none') return 'none';
		return sortDir === 'asc' ? 'ascending' : 'descending';
	}
	function alignRight(c: LedgerColumn): boolean {
		return isNumeric(c) || c.type === 'index';
	}
	function cellTone(t: Trade): '' | 'win' | 'loss' {
		if (t.pnl > 0) return 'win';
		if (t.pnl < 0) return 'loss';
		return '';
	}
</script>

{#if trades.length === 0}
	<EmptyState title="No trades" description="This run did not produce any trades." />
{:else}
	<div class="toolbar">
		<p class="count">
			Showing <strong>{formatInt(filteredSorted.length)}</strong> of {formatInt(trades.length)} trades
		</p>
		<div class="tools">
			{#if hasActiveFilters}
				<IconButton label="Clear filters" size="sm" variant="danger" onclick={clearFilters}>
					<FunnelX size={16} />
				</IconButton>
			{/if}
			<IconButton
				label={filtersOpen ? 'Hide filters' : 'Show filters'}
				size="sm"
				aria-pressed={filtersOpen}
				onclick={() => (filtersOpen = !filtersOpen)}
			>
				<Funnel size={16} weight={filtersOpen ? 'fill' : 'regular'} />
			</IconButton>
		</div>
	</div>

	<div class="scroll" role="region" aria-label="Trade ledger">
		<table>
			<thead>
				<tr>
					{#each LEDGER_COLUMNS as col (col.key)}
						<th
							scope="col"
							class:num={alignRight(col)}
							aria-sort={ariaSort(col.key)}
						>
							<button
								type="button"
								class="sort-btn"
								class:active={sortKey === col.key && sortDir !== 'none'}
								onclick={() => cycleSort(col.key)}
							>
								<span class="th-label">{col.label}</span>
								<span class="sort-ind" aria-hidden="true">
									{#if sortKey === col.key && sortDir === 'asc'}
										<CaretUp size={11} weight="bold" />
									{:else if sortKey === col.key && sortDir === 'desc'}
										<CaretDown size={11} weight="bold" />
									{:else}
										<span class="both"><CaretUp size={9} /><CaretDown size={9} /></span>
									{/if}
								</span>
							</button>
						</th>
					{/each}
				</tr>
				{#if filtersOpen}
					<tr class="filter-row">
						{#each LEDGER_COLUMNS as col (col.key)}
							<th scope="col" class:num={alignRight(col)}>
								{#if col.type === 'enum' && col.enumOptions}
									<Select
										options={[{ value: '', label: 'All' }, ...col.enumOptions(trades)]}
										bind:value={textFilters[col.key]}
									/>
								{:else if col.type === 'text'}
									<input
										class="f-input"
										type="text"
										placeholder="Contains…"
										aria-label="Filter {col.label}"
										bind:value={textFilters[col.key]}
									/>
								{:else if isNumeric(col)}
									<div class="range">
										<input
											class="f-input num"
											type="number"
											placeholder="min"
											aria-label="Minimum {col.label}"
											bind:value={numFilters[col.key].min}
										/>
										<input
											class="f-input num"
											type="number"
											placeholder="max"
											aria-label="Maximum {col.label}"
											bind:value={numFilters[col.key].max}
										/>
									</div>
								{/if}
							</th>
						{/each}
					</tr>
				{/if}
			</thead>

			<tbody>
				{#each filteredSorted as row (row.t.id)}
					<tr class={cellTone(row.t)}>
						{#each LEDGER_COLUMNS as col (col.key)}
							<td class:num={alignRight(col)}>{col.display(row.t, row.i)}</td>
						{/each}
					</tr>
				{:else}
					<tr>
						<td class="no-match" colspan={LEDGER_COLUMNS.length}>No trades match the current filters.</td>
					</tr>
				{/each}
			</tbody>

			<tfoot>
				<tr class="totals">
					<td colspan={LEDGER_COLUMNS.length}>
						<div class="totals-grid">
							<span><b>Trades</b> {formatInt(totals.totalTrades)}</span>
							<span><b>Wins</b> {formatInt(totals.wins)}</span>
							<span><b>Losses</b> {formatInt(totals.losses)}</span>
							<span><b>Win rate</b> {formatPercent(totals.winRate, 1)}</span>
							<span class="good"><b>Gross win</b> {formatSignedCurrency(totals.grossWin)}</span>
							<span class="bad"><b>Gross loss</b> {formatSignedCurrency(totals.grossLoss)}</span>
							<span class:good={totals.net > 0} class:bad={totals.net < 0}>
								<b>Net</b> {formatSignedCurrency(totals.net)}
							</span>
							<span><b>Profit factor</b> {formatRatio(totals.profitFactor)}</span>
							<span><b>Avg win</b> {formatSignedCurrency(totals.avgWin)}</span>
							<span><b>Avg loss</b> {formatSignedCurrency(totals.avgLoss)}</span>
							<span><b>Largest win</b> {formatSignedCurrency(totals.largestWin)}</span>
							<span><b>Largest loss</b> {formatSignedCurrency(totals.largestLoss)}</span>
							<span><b>Avg R</b> {formatRMultiple(totals.avgR)}</span>
							<span class:good={totals.expectancy > 0} class:bad={totals.expectancy < 0}>
								<b>Expectancy</b> {formatSignedCurrency(totals.expectancy)}
							</span>
							<span><b>Avg bars held</b> {formatRatio(totals.avgBarsHeld, 1)}</span>
							<span><b>Total bars</b> {formatInt(totals.totalBars)}</span>
						</div>
					</td>
				</tr>
			</tfoot>
		</table>
	</div>
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		margin-bottom: var(--sp-2);
	}
	.count {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
	.count strong {
		color: var(--c-text);
		font-variant-numeric: tabular-nums;
	}
	.tools {
		display: flex;
		gap: var(--sp-1);
	}

	.scroll {
		max-height: 32rem;
		overflow: auto;
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		background: var(--c-surface);
	}
	.scroll:focus-visible {
		box-shadow: var(--focus-ring);
	}

	table {
		border-collapse: separate;
		border-spacing: 0;
		width: 100%;
		font-size: var(--fs-sm);
	}

	thead th {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--c-surface-2);
		border-bottom: 1px solid var(--c-border-strong);
		padding: 0;
		text-align: left;
		white-space: nowrap;
	}
	thead th.num {
		text-align: right;
	}

	.filter-row th {
		top: 2.1rem;
		z-index: 1;
		padding: var(--sp-1) var(--sp-2);
		background: var(--c-surface-2);
		border-bottom: 1px solid var(--c-border);
		font-weight: 400;
	}

	.sort-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		width: 100%;
		padding: var(--sp-2) var(--sp-3);
		background: transparent;
		border: none;
		color: var(--c-text-muted);
		font-size: var(--fs-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		cursor: pointer;
	}
	th.num .sort-btn {
		justify-content: flex-end;
	}
	.sort-btn:hover {
		color: var(--c-text);
	}
	.sort-btn.active {
		color: var(--c-primary);
	}
	.sort-ind {
		display: inline-flex;
		align-items: center;
		color: currentColor;
	}
	.sort-ind .both {
		display: inline-flex;
		flex-direction: column;
		line-height: 0.5;
		opacity: 0.5;
	}

	tbody td {
		padding: var(--sp-2) var(--sp-3);
		border-bottom: 1px solid var(--c-border);
		white-space: nowrap;
		color: var(--c-text);
	}
	tbody td.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	tbody tr.win {
		background: color-mix(in oklch, var(--c-long-soft) 55%, transparent);
	}
	tbody tr.win td {
		color: color-mix(in oklch, var(--c-text) 78%, var(--c-long));
	}
	tbody tr.loss {
		background: color-mix(in oklch, var(--c-short-soft) 55%, transparent);
	}
	tbody tr.loss td {
		color: color-mix(in oklch, var(--c-text) 78%, var(--c-short));
	}
	tbody tr:hover td {
		background: color-mix(in oklch, var(--c-primary) 6%, transparent);
	}
	.no-match {
		text-align: center;
		color: var(--c-text-muted);
		padding: var(--sp-6);
	}

	tfoot td {
		position: sticky;
		bottom: 0;
		z-index: 2;
		background: var(--c-surface-3);
		border-top: 1px solid var(--c-border-strong);
		padding: var(--sp-3);
	}
	.totals-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: var(--sp-1) var(--sp-4);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.totals-grid span {
		display: flex;
		justify-content: space-between;
		gap: var(--sp-2);
		color: var(--c-text);
	}
	.totals-grid b {
		color: var(--c-text-muted);
		font-weight: 600;
	}
	.totals-grid .good {
		color: var(--c-long);
	}
	.totals-grid .good b,
	.totals-grid .bad b {
		color: inherit;
		opacity: 0.85;
	}
	.totals-grid .bad {
		color: var(--c-short);
	}

	.f-input {
		width: 100%;
		min-width: 4rem;
		padding: 0.25rem 0.4rem;
		background: var(--c-bg);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius-sm);
		color: var(--c-text);
		font-size: var(--fs-xs);
	}
	.f-input:focus-visible {
		border-color: var(--c-primary);
	}
	.f-input.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.range {
		display: flex;
		gap: var(--sp-1);
	}
</style>
