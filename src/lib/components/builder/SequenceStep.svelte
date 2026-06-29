<script lang="ts">
	/**
	 * Compact editor for one child leaf of a `sequence` (best-effort, spec §4b).
	 * The builder only constructs binary children for sequences, so this edits a
	 * binary leaf's left/operator/right inline. Non-binary children (e.g. from an
	 * imported spec) are shown read-only so the builder never breaks.
	 */
	import type { BinaryOperator, ConditionLeaf, Operand } from '$lib/types';
	import { isBinaryLeaf } from '$lib/validation/guards';
	import { isBinaryOperator, operatorLabel } from '$lib/spec/operators';
	import { BINARY_OPERATORS } from '$lib/types';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { Select } from '$lib/components/ui';
	import OperandEditor from './OperandEditor.svelte';

	interface Props {
		store: StrategyStore;
		leaf: ConditionLeaf;
		onchange: (leaf: ConditionLeaf) => void;
	}

	let { store, leaf, onchange }: Props = $props();

	const operatorOptions = BINARY_OPERATORS.filter(isBinaryOperator).map((op) => ({
		value: op,
		label: operatorLabel(op)
	}));

	function setLeft(left: Operand) {
		if (!isBinaryLeaf(leaf)) return;
		onchange({ ...leaf, left });
	}
	function setOp(op: BinaryOperator) {
		if (!isBinaryLeaf(leaf)) return;
		onchange({ ...leaf, op });
	}
	function setRight(right: Operand) {
		if (!isBinaryLeaf(leaf)) return;
		onchange({ ...leaf, right });
	}
</script>

{#if isBinaryLeaf(leaf)}
	<div class="step-row">
		<div class="cell">
			<OperandEditor {store} operand={leaf.left} label="Step left" onchange={setLeft} />
		</div>
		<div class="op">
			<Select
				bind:value={() => leaf.op, (v) => setOp(v as BinaryOperator)}
				options={operatorOptions}
				label="Step operator"
			/>
		</div>
		<div class="cell">
			<OperandEditor {store} operand={leaf.right} label="Step right" onchange={setRight} />
		</div>
	</div>
{:else}
	<p class="note">This step is a {leaf.kind} condition (edit via JSON import).</p>
{/if}

<style>
	.step-row {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-2);
		align-items: start;
	}
	.cell,
	.op {
		min-width: 0;
	}
	.note {
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
	}
	@media (min-width: 48rem) {
		.step-row {
			grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
			align-items: start;
		}
	}
</style>
