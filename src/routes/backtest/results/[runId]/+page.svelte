<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { ArrowLeft, Warning, ChartLine, ChartBar, CalendarBlank, Table } from 'phosphor-svelte';
	import type { Trade } from '$lib/types';
	import { Panel, Callout, ErrorState, EmptyState } from '$lib/components/ui';
	import { formatDateTime } from '$lib/utils/format';

	import SummaryCards from '$lib/components/results/SummaryCards.svelte';
	import TradeTable from '$lib/components/results/TradeTable.svelte';
	import ResultsToolbar from '$lib/components/results/ResultsToolbar.svelte';
	import PriceChartPanel from '$lib/components/results/PriceChartPanel.svelte';
	import EquityCurveChart from '$lib/charts/EquityCurveChart.svelte';
	import DrawdownChart from '$lib/charts/DrawdownChart.svelte';
	import MonthlyHeatmap from '$lib/charts/MonthlyHeatmap.svelte';
	import DistributionHistogram from '$lib/charts/DistributionHistogram.svelte';

	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	const result = $derived(data.result);

	// Trades shown by the table after filtering/sorting — exports use these.
	let filteredTrades = $state<Trade[]>([]);
	function handleFilteredChange(trades: Trade[]) {
		filteredTrades = trades;
	}

	function backToBuilder() {
		goto('/backtest');
	}
</script>

<svelte:head>
	<title>{result ? `${result.spec.name} — Results` : 'Backtest results'}</title>
</svelte:head>

<main class="page">
	{#if data.loadError}
		<div class="back-row">
			<button type="button" class="back" onclick={backToBuilder}>
				<ArrowLeft size={16} /> Back to builder
			</button>
		</div>
		<ErrorState
			title={data.loadError.status === 404 ? 'Run not found' : 'Could not load results'}
			message={data.loadError.message}
			onRetry={() => invalidateAll()}
		/>
	{:else if result}
		<header class="header">
			<div class="heading">
				<button type="button" class="back" onclick={backToBuilder}>
					<ArrowLeft size={16} /> Back to builder
				</button>
				<h1>{result.spec.name}</h1>
				<p class="meta">
					{result.spec.universe.tickers.join(', ')} · {result.spec.universe.timeframe} ·
					{result.spec.universe.dateRange.from} → {result.spec.universe.dateRange.to}
					<span class="dot">·</span>
					Run {formatDateTime(result.computedAt)}
				</p>
			</div>
			<div class="toolbar-slot">
				<ResultsToolbar {result} trades={filteredTrades} />
			</div>
		</header>

		{#if result.warnings.length > 0}
			<Callout tone="warning" title="Warnings from this run">
				{#snippet icon()}<Warning size={18} weight="fill" />{/snippet}
				<ul class="warnings">
					{#each result.warnings as warning, i (i)}
						<li>{warning}</li>
					{/each}
				</ul>
			</Callout>
		{/if}

		<section class="block">
			<SummaryCards metrics={result.metrics} />
		</section>

		<div class="grid-2">
			<Panel title="Equity curve">
				{#snippet icon()}<ChartLine size={18} />{/snippet}
				<EquityCurveChart data={result.equityCurve} />
			</Panel>
			<Panel title="Drawdown">
				{#snippet icon()}<ChartLine size={18} />{/snippet}
				<DrawdownChart data={result.drawdown} />
			</Panel>
		</div>

		<div class="grid-2">
			<Panel title="Monthly returns">
				{#snippet icon()}<CalendarBlank size={18} />{/snippet}
				<MonthlyHeatmap data={result.monthlyReturns} />
			</Panel>
			<Panel title="Trade return distribution">
				{#snippet icon()}<ChartBar size={18} />{/snippet}
				<DistributionHistogram data={result.distribution} />
			</Panel>
		</div>

		<Panel title="Price chart">
			{#snippet icon()}<ChartLine size={18} />{/snippet}
			<PriceChartPanel {result} />
		</Panel>

		<Panel title="Trade ledger">
			{#snippet icon()}<Table size={18} />{/snippet}
			<TradeTable trades={result.trades} onfilteredchange={handleFilteredChange} />
		</Panel>
	{:else}
		<EmptyState title="No result" description="There is nothing to display for this run." />
	{/if}
</main>

<style>
	.page {
		max-width: 90rem;
		margin: 0 auto;
		padding: var(--sp-6) var(--sp-5) var(--sp-12);
		display: flex;
		flex-direction: column;
		gap: var(--sp-6);
	}
	.header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--sp-6);
		flex-wrap: wrap;
	}
	.heading {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		min-width: 0;
	}
	.back-row {
		margin-bottom: var(--sp-4);
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		align-self: flex-start;
		padding: 0;
		background: none;
		border: none;
		color: var(--c-text-muted);
		font-size: var(--fs-sm);
		font-weight: 550;
	}
	.back:hover {
		color: var(--c-primary);
	}
	h1 {
		font-size: var(--fs-2xl);
	}
	.meta {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.dot {
		margin: 0 var(--sp-1);
		color: var(--c-text-faint);
	}
	.toolbar-slot {
		flex: 1 1 22rem;
		min-width: 16rem;
	}
	.block {
		margin-top: var(--sp-1);
	}
	.grid-2 {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-5);
	}
	@media (min-width: 64rem) {
		.grid-2 {
			grid-template-columns: 1fr 1fr;
		}
	}
	.warnings {
		margin: 0;
		padding-left: var(--sp-4);
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
	}
</style>
