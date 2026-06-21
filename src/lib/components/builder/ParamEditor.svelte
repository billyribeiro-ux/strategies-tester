<script lang="ts">
	import type { IndicatorCapability, IndicatorInstance } from '$lib/types';
	import { isBoolParam, isEnumParam, isNumericParam } from '$lib/validation/guards';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { NumberInput, Select, Toggle } from '$lib/components/ui';

	interface Props {
		store: StrategyStore;
		instance: IndicatorInstance;
		capability: IndicatorCapability;
	}

	let { store, instance, capability }: Props = $props();

	function numberValue(name: string, fallback: number): number {
		const v = instance.params[name];
		return typeof v === 'number' ? v : fallback;
	}
	function stringValue(name: string, fallback: string): string {
		const v = instance.params[name];
		return typeof v === 'string' ? v : fallback;
	}
	function boolValue(name: string, fallback: boolean): boolean {
		const v = instance.params[name];
		return typeof v === 'boolean' ? v : fallback;
	}
</script>

{#if capability.params.length === 0}
	<p class="no-params">No parameters.</p>
{:else}
	<div class="params">
		{#each capability.params as param (param.name)}
			{#if isNumericParam(param)}
				<NumberInput
					label={param.label}
					bind:value={
						() => numberValue(param.name, param.default),
						(v) =>
							store.setIndicatorParam(
								instance.id,
								param.name,
								param.kind === 'int' ? Math.round(v) : v
							)
					}
					min={param.min}
					max={param.max}
					step={param.step ?? (param.kind === 'int' ? 1 : 0.1)}
					suffix={param.unit}
				/>
			{:else if isEnumParam(param)}
				<Select
					label={param.label}
					options={param.options}
					bind:value={
						() => stringValue(param.name, param.default),
						(v) => store.setIndicatorParam(instance.id, param.name, v)
					}
				/>
			{:else if isBoolParam(param)}
				<div class="bool-param">
					<Toggle
						label={param.label}
						bind:checked={
							() => boolValue(param.name, param.default),
							(v) => store.setIndicatorParam(instance.id, param.name, v)
						}
					/>
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.params {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
		gap: var(--sp-3);
	}
	.no-params {
		font-size: var(--fs-sm);
		color: var(--c-text-faint);
	}
	.bool-param {
		display: flex;
		align-items: center;
		min-height: 2.25rem;
	}
</style>
