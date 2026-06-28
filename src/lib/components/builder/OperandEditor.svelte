<script lang="ts">
	import type { AggregateFn, Operand, OperandKind, PriceField } from '$lib/types';
	import { AGGREGATE_FNS, PRICE_FIELDS } from '$lib/types';
	import { defaultOperand, indicatorLabel } from '$lib/spec/defaults';
	import { isConstantOperand, isIndicatorOperand, isPriceOperand } from '$lib/validation/guards';
	import { assertNever } from '$lib/utils/assert-never';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { NumberInput, SegmentedControl, Select } from '$lib/components/ui';
	import Self from './OperandEditor.svelte';

	interface Props {
		store: StrategyStore;
		operand: Operand;
		/** Label for the kind switcher (a11y). */
		label: string;
		onchange: (operand: Operand) => void;
		/** Allow the "constant value" kind (false for rising/falling primary). */
		allowConstant?: boolean;
		/** Allow the "aggregate" kind (false inside an aggregate, to bound nesting). */
		allowAggregate?: boolean;
	}

	let {
		store,
		operand,
		label,
		onchange,
		allowConstant = true,
		allowAggregate = true
	}: Props = $props();

	const kindOptions = $derived([
		{ value: 'indicator', label: 'Indicator' },
		{ value: 'price', label: 'Price' },
		...(allowConstant ? [{ value: 'constant', label: 'Value' }] : []),
		...(allowAggregate ? [{ value: 'aggregate', label: 'Aggregate' }] : [])
	]);

	const aggregateFnOptions = AGGREGATE_FNS.map((f) => ({ value: f, label: f }));

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
			case 'aggregate':
				onchange(defaultOperand('aggregate'));
				break;
			default:
				assertNever(next);
		}
	}

	function emitAggregateFn(next: AggregateFn) {
		if (operand.kind !== 'aggregate') return;
		onchange({ ...operand, fn: next });
	}

	function emitAggregateSource(next: Operand) {
		if (operand.kind !== 'aggregate') return;
		onchange({ ...operand, source: next });
	}

	function emitAggregateWindow(next: number) {
		if (operand.kind !== 'aggregate') return;
		onchange({ ...operand, window: Math.max(1, Math.round(next)) });
	}

	function emitAggregateOffset(next: number) {
		if (operand.kind !== 'aggregate') return;
		onchange({ ...operand, offset: Math.max(0, Math.round(next)) });
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
		{:else if operand.kind === 'aggregate'}
			<div class="aggregate">
				<div class="agg-head">
					<div class="agg-fn">
						<Select
							bind:value={() => operand.fn, (v) => emitAggregateFn(v as AggregateFn)}
							options={aggregateFnOptions}
							label="{label}: aggregate function"
						/>
					</div>
					<div class="agg-num">
						<NumberInput
							bind:value={() => operand.window, (v) => emitAggregateWindow(v)}
							min={1}
							step={1}
							suffix="bars"
							label="{label}: window"
						/>
					</div>
					<div class="agg-num">
						<NumberInput
							bind:value={() => operand.offset, (v) => emitAggregateOffset(v)}
							min={0}
							step={1}
							suffix="bars ago"
							label="{label}: offset"
						/>
					</div>
				</div>
				<div class="agg-source">
					<span class="agg-of" aria-hidden="true">of</span>
					<div class="grow">
						<!-- Nested: the series being aggregated. Aggregate-of-aggregate is
							 disallowed to keep the construct readable and bound depth. -->
						<Self
							{store}
							operand={operand.source}
							label="{label}: source"
							allowConstant={false}
							allowAggregate={false}
							onchange={emitAggregateSource}
						/>
					</div>
				</div>
			</div>
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
	.aggregate {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		padding: var(--sp-2);
		border: 1px dashed var(--c-border);
		border-radius: var(--radius);
	}
	.agg-head {
		display: flex;
		gap: var(--sp-2);
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.agg-fn {
		flex: 1 1 8rem;
		min-width: 7rem;
	}
	.agg-num {
		flex: 0 1 8rem;
		min-width: 6.5rem;
	}
	.agg-source {
		display: flex;
		gap: var(--sp-2);
		align-items: flex-start;
	}
	.agg-of {
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding-top: var(--sp-2);
	}
</style>
