<script lang="ts">
	import type { FillModel, OrderType } from '$lib/types';
	import { assertNever } from '$lib/utils/assert-never';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { Callout, Field, NumberInput, Panel, Select } from '$lib/components/ui';
	import { Info, Lightning } from 'phosphor-svelte';

	interface Props {
		store: StrategyStore;
	}

	let { store }: Props = $props();

	const FILL_LABELS: Record<FillModel, string> = {
		nextOpen: 'Next bar open',
		close: 'Signal bar close',
		signalPrice: 'Signal price'
	};

	const ORDER_LABELS: Record<OrderType, string> = {
		market: 'Market',
		limit: 'Limit',
		stop: 'Stop'
	};

	function fillLabel(m: FillModel): string {
		switch (m) {
			case 'nextOpen':
			case 'close':
			case 'signalPrice':
				return FILL_LABELS[m];
			default:
				return assertNever(m);
		}
	}

	const fillOptions = $derived(
		store.capabilities.fillModels.map((m) => ({ value: m, label: fillLabel(m) }))
	);
	const orderOptions = $derived(
		store.capabilities.orderTypes.map((m) => ({ value: m, label: ORDER_LABELS[m] }))
	);

	const fillOn = $derived(store.spec.execution.fillOn);
	const liquidityCap = $derived(store.spec.execution.maxBarVolumePct ?? 0);
</script>

<Panel title="Execution" description="How signalled orders are filled.">
	{#snippet icon()}<Lightning size={18} />{/snippet}

	<div class="grid">
		<Field label="Fill on" noFor>
			{#snippet children({ labelId })}
				<div class="seg-row" role="radiogroup" aria-labelledby={labelId}>
					{#each fillOptions as opt (opt.value)}
						<button
							type="button"
							class="seg-opt"
							class:active={fillOn === opt.value}
							role="radio"
							aria-checked={fillOn === opt.value}
							onclick={() => store.setFillModel(opt.value as FillModel)}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			{/snippet}
		</Field>

		<Select
			label="Order type"
			options={orderOptions}
			bind:value={() => store.spec.execution.orderType, (v) => store.setOrderType(v as OrderType)}
		/>

		<NumberInput
			label="Max % of bar volume (liquidity cap)"
			hint="Caps each fill at this share of the bar's volume. Leave 0 (or empty) for no cap."
			min={0}
			max={100}
			step={1}
			suffix="%"
			bind:value={
				() => liquidityCap, (pct) => store.setExecutionLiquidityCap(pct > 0 ? pct : undefined)
			}
		/>
	</div>

	{#if fillOn === 'nextOpen'}
		<Callout tone="success" title="No look-ahead bias">
			{#snippet icon()}<Info size={16} weight="fill" />{/snippet}
			Orders fill at the open of the bar after the signal. Signals are point-in-time, so the backtest
			can never act on information it would not have had live.
		</Callout>
	{:else if fillOn === 'close'}
		<Callout tone="warning" title="Assumes you can act on the close">
			{#snippet icon()}<Info size={16} weight="fill" />{/snippet}
			Orders fill at the close of the signalling bar. This is optimistic unless your data and workflow
			truly let you trade the closing print.
		</Callout>
	{:else}
		<Callout tone="warning" title="Fills at the signal price">
			{#snippet icon()}<Info size={16} weight="fill" />{/snippet}
			Orders fill at the price that produced the signal. Use only when that exact price is reachable intrabar;
			otherwise prefer next bar open.
		</Callout>
	{/if}
</Panel>

<style>
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-4);
		margin-bottom: var(--sp-4);
	}
	.seg-row {
		display: inline-flex;
		flex-wrap: wrap;
		padding: 2px;
		gap: 2px;
		background: var(--c-surface-2);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		width: fit-content;
		max-width: 100%;
	}
	.seg-opt {
		padding: 0.3125rem 0.75rem;
		font-size: var(--fs-sm);
		border: none;
		background: transparent;
		color: var(--c-text-muted);
		border-radius: calc(var(--radius) - 2px);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.seg-opt:hover {
		color: var(--c-text);
	}
	.seg-opt.active {
		background: var(--c-surface);
		color: var(--c-text);
		box-shadow: var(--shadow-sm);
	}

	@media (min-width: 40rem) {
		.grid {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}
</style>
