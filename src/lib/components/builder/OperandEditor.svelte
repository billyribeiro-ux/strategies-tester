<script lang="ts">
	import type { Operand, OperandKind, PriceField } from '$lib/types';
	import { PRICE_FIELDS } from '$lib/types';
	import { indicatorLabel } from '$lib/spec/defaults';
	import { isConstantOperand, isIndicatorOperand, isPriceOperand } from '$lib/validation/guards';
	import { assertNever } from '$lib/utils/assert-never';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { NumberInput, SegmentedControl, Select } from '$lib/components/ui';

	interface Props {
		store: StrategyStore;
		operand: Operand;
		/** Label for the kind switcher (a11y). */
		label: string;
		onchange: (operand: Operand) => void;
		/** Allow the "constant value" kind (false for rising/falling primary). */
		allowConstant?: boolean;
	}

	let { store, operand, label, onchange, allowConstant = true }: Props = $props();

	const kindOptions = $derived(
		allowConstant
			? [
					{ value: 'indicator', label: 'Indicator' },
					{ value: 'price', label: 'Price' },
					{ value: 'constant', label: 'Value' }
				]
			: [
					{ value: 'indicator', label: 'Indicator' },
					{ value: 'price', label: 'Price' }
				]
	);

	const indicatorOptions = $derived(
		store.spec.indicators.map((ind) => ({
			value: ind.id,
			label: indicatorLabel(ind, store.capabilityFor(ind))
		}))
	);

	const priceOptions = PRICE_FIELDS.map((f) => ({ value: f, label: f }));

	function capabilityFor(ref: string) {
		const ind = store.spec.indicators.find((i) => i.id === ref);
		return ind ? store.capabilityFor(ind) : undefined;
	}

	const componentOptions = $derived.by(() => {
		if (!isIndicatorOperand(operand) || !operand.ref) return [];
		const cap = capabilityFor(operand.ref);
		if (!cap || cap.components.length <= 1) return [];
		return cap.components.map((c) => ({ value: c, label: c }));
	});

	function emitKind(next: OperandKind) {
		if (next === operand.kind) return;
		switch (next) {
			case 'indicator': {
				const first = store.spec.indicators[0];
				const cap = first ? store.capabilityFor(first) : undefined;
				const comp = cap && cap.components.length > 1 ? cap.components[0] : undefined;
				onchange({ kind: 'indicator', ref: first?.id ?? '', component: comp, offset: 0 });
				break;
			}
			case 'price':
				onchange({ kind: 'price', field: 'close', offset: 0 });
				break;
			case 'constant':
				onchange({ kind: 'constant', value: 0 });
				break;
			default:
				assertNever(next);
		}
	}

	function emitRef(nextRef: string) {
		const cap = capabilityFor(nextRef);
		const comp = cap && cap.components.length > 1 ? cap.components[0] : undefined;
		const offset = isIndicatorOperand(operand) ? operand.offset : 0;
		onchange({ kind: 'indicator', ref: nextRef, component: comp, offset });
	}

	function emitComponent(nextComponent: string) {
		if (!isIndicatorOperand(operand)) return;
		onchange({ ...operand, component: nextComponent });
	}

	function emitOffset(next: number) {
		if (isConstantOperand(operand)) return;
		onchange({ ...operand, offset: Math.max(0, Math.round(next)) });
	}

	function emitField(next: string) {
		const offset = isPriceOperand(operand) ? operand.offset : 0;
		onchange({ kind: 'price', field: next as PriceField, offset });
	}

	function emitValue(next: number) {
		onchange({ kind: 'constant', value: next });
	}
</script>

<div class="operand">
	<SegmentedControl
		bind:value={() => operand.kind, (v) => emitKind(v as OperandKind)}
		options={kindOptions}
		size="sm"
		label="{label}: operand type"
	/>

	<div class="detail">
		{#if isIndicatorOperand(operand)}
			{#if indicatorOptions.length === 0}
				<p class="hint">Declare an indicator first.</p>
			{:else}
				<div class="ind-fields">
					<div class="grow">
						<Select
							bind:value={() => operand.ref, (v) => emitRef(v)}
							options={indicatorOptions}
							placeholder="Select indicator"
							label="{label}: indicator"
						/>
					</div>
					{#if componentOptions.length > 0}
						<div class="component">
							<Select
								bind:value={() => operand.component ?? '', (v) => emitComponent(v)}
								options={componentOptions}
								placeholder="Line"
								label="{label}: component"
							/>
						</div>
					{/if}
					<div class="offset">
						<NumberInput
							bind:value={() => operand.offset, (v) => emitOffset(v)}
							min={0}
							step={1}
							suffix="bars ago"
							label="{label}: offset"
						/>
					</div>
				</div>
			{/if}
		{:else if isPriceOperand(operand)}
			<div class="price-fields">
				<div class="grow">
					<Select
						bind:value={() => operand.field, (v) => emitField(v)}
						options={priceOptions}
						label="{label}: price field"
					/>
				</div>
				<div class="offset">
					<NumberInput
						bind:value={() => operand.offset, (v) => emitOffset(v)}
						min={0}
						step={1}
						suffix="bars ago"
						label="{label}: offset"
					/>
				</div>
			</div>
		{:else if isConstantOperand(operand)}
			<NumberInput
				bind:value={() => operand.value, (v) => emitValue(v)}
				step={0.0001}
				label="{label}: value"
			/>
		{/if}
	</div>
</div>

<style>
	.operand {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		min-width: 0;
	}
	.detail {
		min-width: 0;
	}
	.ind-fields,
	.price-fields {
		display: flex;
		gap: var(--sp-2);
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.grow {
		flex: 1 1 9rem;
		min-width: 7rem;
	}
	.component {
		flex: 0 1 7rem;
		min-width: 5.5rem;
	}
	.offset {
		flex: 0 1 9rem;
		min-width: 7rem;
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
		padding: var(--sp-1) 0;
	}
</style>
