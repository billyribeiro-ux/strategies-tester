<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { StrategyStore } from '$lib/stores/strategy.svelte';
	import { Callout, ErrorState, LoadingState } from '$lib/components/ui';
	import BuilderToolbar from '$lib/components/builder/BuilderToolbar.svelte';
	import UniversePanel from '$lib/components/builder/UniversePanel.svelte';
	import IndicatorsPanel from '$lib/components/builder/IndicatorsPanel.svelte';
	import RuleBuilder from '$lib/components/builder/RuleBuilder.svelte';
	import RiskPanel from '$lib/components/builder/RiskPanel.svelte';
	import ExecutionPanel from '$lib/components/builder/ExecutionPanel.svelte';
	import ValidationSummary from '$lib/components/builder/ValidationSummary.svelte';

	let { data }: PageProps = $props();

	function makeStore(d: PageProps['data']): StrategyStore | null {
		if (!d.capabilities) return null;
		const s = new StrategyStore(d.capabilities, d.saved?.spec);
		if (d.saved) s.savedId = d.saved.id;
		return s;
	}

	// Rebuilt automatically when load data changes (navigation/invalidation);
	// stable during in-page editing since `data` identity is unchanged then.
	const store = $derived.by(() => makeStore(data));

	async function handleRun() {
		if (!store) return;
		const runId = await store.run();
		if (runId) goto(`/backtest/results/${runId}`);
	}

	async function handleSave() {
		if (!store) return;
		await store.save();
	}
</script>

<svelte:head>
	<title>Strategy builder · Backtest</title>
</svelte:head>

{#if data.error}
	<div class="state-wrap">
		<ErrorState
			title="Could not load the builder"
			message={data.error}
			onRetry={() => invalidateAll()}
		/>
	</div>
{:else if !store}
	<div class="state-wrap">
		<LoadingState label="Loading capabilities…" />
	</div>
{:else}
	<div class="builder">
		<header class="toolbar-bar">
			<div class="toolbar-inner">
				<BuilderToolbar {store} onrun={handleRun} onsave={handleSave} />
			</div>
		</header>

		<main class="content">
			{#if store.runError}
				<Callout tone="danger" title="Backtest failed">{store.runError}</Callout>
			{/if}
			{#if store.saveError}
				<Callout tone="danger" title="Save failed">{store.saveError}</Callout>
			{/if}

			<ValidationSummary {store} />

			<div class="columns">
				<div class="col">
					<UniversePanel {store} />
					<IndicatorsPanel {store} />
				</div>
				<div class="col">
					<ExecutionPanel {store} />
				</div>
			</div>

			<section class="rules-section">
				<h2 class="section-title">Rules</h2>
				<RuleBuilder {store} />
			</section>

			<RiskPanel {store} />
		</main>
	</div>
{/if}

<style>
	.state-wrap {
		max-width: 48rem;
		margin: 0 auto;
		padding: var(--sp-12) var(--sp-4);
	}
	.builder {
		min-height: 100dvh;
	}
	.toolbar-bar {
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
		background: color-mix(in oklch, var(--c-surface) 92%, transparent);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--c-border);
	}
	.toolbar-inner {
		max-width: 80rem;
		margin: 0 auto;
		padding: var(--sp-3) var(--sp-4);
	}
	.content {
		max-width: 80rem;
		margin: 0 auto;
		padding: var(--sp-5) var(--sp-4) var(--sp-16);
		display: flex;
		flex-direction: column;
		gap: var(--sp-5);
	}
	.columns {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-5);
		align-items: start;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: var(--sp-5);
		min-width: 0;
	}
	.rules-section {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.section-title {
		font-size: var(--fs-lg);
		font-weight: 600;
	}

	@media (min-width: 64rem) {
		.columns {
			grid-template-columns: 1.4fr 1fr;
		}
	}
</style>
