<script lang="ts">
	import type { IndicatorInstance, PriceField } from '$lib/types';
	import { indicatorLabel } from '$lib/spec/defaults';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { Badge, Callout, IconButton, Select, TextInput } from '$lib/components/ui';
	import { Trash } from 'phosphor-svelte';
	import ParamEditor from './ParamEditor.svelte';

	interface Props {
		store: StrategyStore;
		instance: IndicatorInstance;
	}

	let { store, instance }: Props = $props();

	const capability = $derived(store.capabilityFor(instance));
	const displayLabel = $derived(indicatorLabel(instance, capability));

	const priceSourceOptions = $derived(
		capability ? capability.allowedPriceSources.map((s) => ({ value: s, label: s })) : []
	);

	// Multi-timeframe picker (spec §3). Offer the chart (base) timeframe plus any
	// HIGHER timeframe; never a lower one (it would fabricate sub-bar data). The
	// empty value clears the reference back to "Chart (base)".
	const baseSeconds = $derived(
		store.capabilities.timeframes.find((t) => t.id === store.spec.universe.timeframe)?.seconds ?? 0
	);
	const timeframeOptions = $derived([
		{ value: '', label: 'Chart (base)' },
		...store.capabilities.timeframes
			.filter((t) => t.seconds > baseSeconds)
			.map((t) => ({ value: t.id, label: t.label }))
	]);
</script>

<div class="indicator">
	<header class="head">
		<div class="title">
			<span class="name">{displayLabel}</span>
			<Badge tone="primary" size="sm">{instance.type}</Badge>
		</div>
		<IconButton
			label="Remove {displayLabel}"
			variant="danger"
			size="sm"
			onclick={() => store.removeIndicator(instance.id)}
		>
			<Trash size={15} />
		</IconButton>
	</header>

	{#if !capability}
		<Callout tone="danger">
			Unknown indicator type "{instance.type}" — it is not offered by the backend. Remove it or
			re-import a compatible strategy.
		</Callout>
	{:else}
		<div class="grid">
			<TextInput
				label="Label"
				placeholder={capability.label}
				value={instance.label ?? ''}
				oninput={(e) => store.setIndicatorLabel(instance.id, e.currentTarget.value)}
			/>
			<Select
				label="Price source"
				options={priceSourceOptions}
				bind:value={
					() => instance.priceSource,
					(v) => store.setIndicatorPriceSource(instance.id, v as PriceField)
				}
			/>
			<Select
				label="Timeframe"
				hint="Compute on a higher timeframe (aligned to the chart with no look-ahead)."
				options={timeframeOptions}
				bind:value={
					() => instance.timeframe ?? '',
					(v) => store.setIndicatorTimeframe(instance.id, v || undefined)
				}
			/>
		</div>

		<ParamEditor {store} {instance} {capability} />

		{#if capability.description}
			<p class="desc">{capability.description}</p>
		{/if}
	{/if}
</div>

<style>
	.indicator {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
		padding: var(--sp-4);
		background: var(--c-surface-2);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
	}
	.title {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		min-width: 0;
	}
	.name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-3);
	}
	.desc {
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
	}

	@media (min-width: 40rem) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
