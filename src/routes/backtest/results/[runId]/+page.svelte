<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import {
		ArrowLeft,
		Warning,
		ChartLine,
		ChartBar,
		CalendarBlank,
		Table,
		ShieldCheck,
		ChartPolar
	} from 'phosphor-svelte';
	import type { Trade, ValidationReport } from '$lib/types';
	import { Panel, Callout, ErrorState, EmptyState, Button } from '$lib/components/ui';
	import { ValidationPanel } from '$lib/components/validation';
	import { createApiClient, ApiError } from '$lib/api/client';
	import { formatDateTime } from '$lib/utils/format';

	import SummaryCards from '$lib/components/results/SummaryCards.svelte';
	import AnalyticsPanel from '$lib/components/results/AnalyticsPanel.svelte';
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
	const api = createApiClient();

	// Trades shown by the table after filtering/sorting — exports use these.
	let filteredTrades = $state<Trade[]>([]);
	function handleFilteredChange(trades: Trade[]) {
		filteredTrades = trades;
	}

	// Statistical validation (Deflated Sharpe + Monte-Carlo) for this run.
	let validating = $state(false);
	let valError = $state<string | null>(null);
	let validation = $state<ValidationReport | null>(null);

	async function runValidation() {
		if (!result) return;
		valError = null;
		validating = true;
		validation = null;
		try {
			validation = await api.validateStrategy(result.spec);
		} catch (e) {
			valError = e instanceof ApiError ? e.message : 'Validation failed.';
		} finally {
			validating = false;
		}
	}

	// Performance analytics (spec §7) for this run — loaded on demand from
	// /api/analytics. We call fetch directly (not the api client) and parse the
	// body as text → JSON to dodge the SSR content-type header restriction.
	type AnalyticsView = ComponentProps<typeof AnalyticsPanel>['analytics'];
	let analyticsLoading = $state(false);
	let analyticsError = $state<string | null>(null);
	let analytics = $state<AnalyticsView>(null);

	async function loadAnalytics() {
		if (!result) return;
		analyticsError = null;
		analyticsLoading = true;
		analytics = null;
		try {
			const res = await fetch(`/api/analytics?runId=${encodeURIComponent(result.runId)}`);
			const text = await res.text().catch(() => '');
			let payload: unknown = text.length ? text : undefined;
			if (text.length) {
				try {
					payload = JSON.parse(text);
				} catch {
					payload = text;
				}
			}
			if (!res.ok) {
				const message =
					payload && typeof payload === 'object' && 'message' in payload
						? String((payload as { message: unknown }).message)
						: `Request failed (${res.status})`;
				throw new Error(message);
			}
			analytics = payload as AnalyticsView;
		} catch (e) {
			analyticsError = e instanceof Error ? e.message : 'Analytics failed.';
		} finally {
			analyticsLoading = false;
		}
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
				<EquityCurveChart data={result.equityCurve} benchmark={result.benchmark?.equity} />
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

		<Panel title="Statistical validation">
			{#snippet icon()}<ShieldCheck size={18} />{/snippet}
			{#if !validation && !validating}
				<div class="validate-cta">
					<p>
						Stress-test this run for overfitting: Deflated Sharpe, Monte-Carlo trade-order and
						bootstrap spreads, and a randomized-entry null baseline.
					</p>
					<Button variant="primary" onclick={runValidation}>
						{#snippet icon()}<ShieldCheck size={16} />{/snippet}
						Run validation
					</Button>
				</div>
			{/if}
			{#if valError}
				<Callout tone="danger" title="Validation failed">
					{#snippet icon()}<Warning size={16} weight="fill" />{/snippet}
					{valError}
					{#if /api key/i.test(valError)}
						— <a href="/settings">Add your FMP key in Settings</a>.
					{/if}
				</Callout>
			{/if}
			{#if validating || validation}
				<ValidationPanel report={validation} loading={validating} />
			{/if}
		</Panel>

		<Panel title="Performance analytics">
			{#snippet icon()}<ChartPolar size={18} />{/snippet}
			{#if !analytics && !analyticsLoading && !analyticsError}
				<div class="validate-cta">
					<p>
						Tail risk and drawdown shape: CVaR, ulcer index, Calmar, Omega, time underwater and
						losing-streak length, with attribution by symbol, side and exit reason plus per-year
						returns.
					</p>
					<Button variant="primary" onclick={loadAnalytics}>
						{#snippet icon()}<ChartPolar size={16} />{/snippet}
						Load analytics
					</Button>
				</div>
			{/if}
			{#if analyticsLoading || analytics || analyticsError}
				<AnalyticsPanel {analytics} loading={analyticsLoading} error={analyticsError} />
			{/if}
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
	.validate-cta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	.validate-cta p {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		max-width: 40rem;
	}
</style>
