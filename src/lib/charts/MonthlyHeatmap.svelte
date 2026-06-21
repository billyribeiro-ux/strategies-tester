<script lang="ts">
	import { max as d3max } from 'd3-array';
	import type { MonthlyReturn } from '$lib/types';
	import { formatSignedPercent } from '$lib/utils/format';
	import { divergingFill } from './theme';
	import { EmptyState } from '$lib/components/ui';

	interface Props {
		data: MonthlyReturn[];
	}
	let { data }: Props = $props();

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	// Group into a year → (month → return) lookup and derive the ordered years.
	const byYear = $derived(
		(() => {
			const map = new Map<number, Map<number, number>>();
			for (const r of data) {
				if (!map.has(r.year)) map.set(r.year, new Map());
				map.get(r.year)!.set(r.month, r.returnPct);
			}
			return map;
		})()
	);
	const years = $derived([...byYear.keys()].sort((a, b) => a - b));

	// Symmetric color scale anchored on the largest absolute monthly return.
	const maxAbs = $derived(d3max(data, (r) => Math.abs(r.returnPct)) ?? 0);

	function cell(year: number, month: number): number | undefined {
		return byYear.get(year)?.get(month);
	}
	function fill(value: number | undefined): string {
		if (value === undefined) return 'transparent';
		const t = maxAbs > 0 ? value / maxAbs : 0;
		return divergingFill(t);
	}
	function textTone(value: number | undefined): string {
		if (value === undefined) return 'var(--c-text-faint)';
		return Math.abs(value) / (maxAbs || 1) > 0.55 ? 'var(--c-primary-contrast)' : 'var(--c-text)';
	}
</script>

{#if years.length === 0}
	<EmptyState title="No monthly returns" description="This run produced no monthly breakdown." compact />
{:else}
	<div class="heatmap">
		<table>
			<caption class="sr-only">Monthly returns by year</caption>
			<thead>
				<tr>
					<th scope="col" class="corner">Year</th>
					{#each MONTHS as month (month)}
						<th scope="col">{month}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each years as year (year)}
					<tr>
						<th scope="row" class="year">{year}</th>
						{#each MONTHS as _month, mi (mi)}
							{@const v = cell(year, mi + 1)}
							<td
								class="cell"
								class:empty={v === undefined}
								style:background={fill(v)}
								style:color={textTone(v)}
								title={v === undefined ? '' : `${MONTHS[mi]} ${year}: ${formatSignedPercent(v)}`}
							>
								{v === undefined ? '' : formatSignedPercent(v, 1)}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>

		<div class="legend" aria-hidden="true">
			<span class="cap">{formatSignedPercent(-maxAbs, 1)}</span>
			<span class="bar" style:background="linear-gradient(to right, {divergingFill(-1)}, {divergingFill(0)}, {divergingFill(1)})"
			></span>
			<span class="cap">{formatSignedPercent(maxAbs, 1)}</span>
		</div>
	</div>
{/if}

<style>
	.heatmap {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	table {
		border-collapse: separate;
		border-spacing: 2px;
		width: 100%;
		table-layout: fixed;
	}
	th {
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--c-text-muted);
		text-align: center;
		padding: var(--sp-1);
	}
	th.corner,
	th.year {
		text-align: left;
		width: 3.5rem;
	}
	th.year {
		color: var(--c-text);
		font-variant-numeric: tabular-nums;
	}
	.cell {
		text-align: center;
		padding: 0.4rem 0.25rem;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		border-radius: var(--radius-sm);
		border: 1px solid var(--c-border);
	}
	.cell.empty {
		border-style: dashed;
		border-color: var(--c-border);
	}
	.legend {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		align-self: flex-end;
	}
	.cap {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.bar {
		width: 8rem;
		height: 0.625rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--c-border);
	}
</style>
