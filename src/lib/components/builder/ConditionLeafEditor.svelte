<script lang="ts">
	import type { ConditionLeaf, Operand, Operator, RuleSection } from '$lib/types';
	import { isBinaryLeaf, isRangeLeaf, isUnaryLeaf } from '$lib/validation/guards';
	import type { SpecIssue } from '$lib/validation';
	import {
		isBinaryOperator,
		isRangeOperator,
		isUnaryOperator,
		operatorArity,
		operatorLabel,
		operatorsForOperand
	} from '$lib/spec/operators';
	import {
		createBinaryLeaf,
		createRangeLeaf,
		createUnaryLeaf,
		defaultOperand
	} from '$lib/spec/defaults';
	import { assertNever } from '$lib/utils/assert-never';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { IconButton, NumberInput, Select } from '$lib/components/ui';
	import { Trash } from 'phosphor-svelte';
	import OperandEditor from './OperandEditor.svelte';

	interface Props {
		store: StrategyStore;
		section: RuleSection;
		leaf: ConditionLeaf;
	}

	let { store, section, leaf }: Props = $props();

	const offeredOperators = $derived(store.capabilities.operators.map((o) => o.id));

	/** The primary operand drives which operators are offered. */
	const primaryOperand = $derived.by((): Operand => {
		if (isBinaryLeaf(leaf)) return leaf.left;
		return leaf.operand;
	});

	const operatorOptions = $derived(
		operatorsForOperand(primaryOperand, offeredOperators).map((op) => ({
			value: op,
			label: operatorLabel(op)
		}))
	);

	const leafIssues = $derived<SpecIssue[]>(store.nodeIssues.get(leaf.id) ?? []);
	const errors = $derived(leafIssues.filter((i) => i.severity === 'error'));
	const warnings = $derived(leafIssues.filter((i) => i.severity === 'warning'));

	/** Switch the operator, rebuilding the leaf when arity changes. */
	function changeOperator(nextOp: Operator) {
		if (nextOp === leaf.op) return;
		const nextArity = operatorArity(nextOp);
		if (nextArity === operatorArity(leaf.op)) {
			// Same arity — keep all operands, swap the op.
			if (isBinaryOperator(nextOp) && isBinaryLeaf(leaf)) {
				store.replaceLeaf(section, leaf.id, { ...leaf, op: nextOp });
			} else if (isUnaryOperator(nextOp) && isUnaryLeaf(leaf)) {
				store.replaceLeaf(section, leaf.id, { ...leaf, op: nextOp });
			} else if (isRangeOperator(nextOp) && isRangeLeaf(leaf)) {
				store.replaceLeaf(section, leaf.id, { ...leaf, op: nextOp });
			}
			return;
		}
		// Arity changed — rebuild the leaf, preserving the primary operand.
		const primary = primaryOperand;
		if (isBinaryOperator(nextOp)) {
			store.replaceLeaf(section, leaf.id, {
				...createBinaryLeaf(primary, nextOp, defaultOperand('constant')),
				id: leaf.id
			});
		} else if (isUnaryOperator(nextOp)) {
			// rising/falling need a series; fall back to price if the primary is a constant.
			const operand = primary.kind === 'constant' ? defaultOperand('price') : primary;
			store.replaceLeaf(section, leaf.id, { ...createUnaryLeaf(operand, nextOp, 1), id: leaf.id });
		} else if (isRangeOperator(nextOp)) {
			store.replaceLeaf(section, leaf.id, {
				...createRangeLeaf(primary, nextOp, defaultOperand('constant'), {
					kind: 'constant',
					value: 1
				}),
				id: leaf.id
			});
		} else {
			assertNever(nextOp);
		}
	}

	function setLeft(operand: Operand) {
		if (!isBinaryLeaf(leaf)) return;
		store.replaceLeaf(section, leaf.id, { ...leaf, left: operand });
	}
	function setRight(operand: Operand) {
		if (!isBinaryLeaf(leaf)) return;
		store.replaceLeaf(section, leaf.id, { ...leaf, right: operand });
	}
	function setUnaryOperand(operand: Operand) {
		if (!isUnaryLeaf(leaf)) return;
		store.replaceLeaf(section, leaf.id, { ...leaf, operand });
	}
	function setLookback(value: number) {
		if (!isUnaryLeaf(leaf)) return;
		store.replaceLeaf(section, leaf.id, { ...leaf, lookback: Math.max(1, Math.round(value)) });
	}
	function setRangeOperand(operand: Operand) {
		if (!isRangeLeaf(leaf)) return;
		store.replaceLeaf(section, leaf.id, { ...leaf, operand });
	}
	function setLower(operand: Operand) {
		if (!isRangeLeaf(leaf)) return;
		store.replaceLeaf(section, leaf.id, { ...leaf, lower: operand });
	}
	function setUpper(operand: Operand) {
		if (!isRangeLeaf(leaf)) return;
		store.replaceLeaf(section, leaf.id, { ...leaf, upper: operand });
	}
</script>

<div class="leaf" class:has-error={errors.length > 0}>
	<div class="row">
		{#if isBinaryLeaf(leaf)}
			<div class="operand-cell">
				<OperandEditor {store} operand={leaf.left} label="Left" onchange={setLeft} />
			</div>
			<div class="op-cell">
				<Select
					bind:value={() => leaf.op, (v) => changeOperator(v as Operator)}
					options={operatorOptions}
					label="Operator"
				/>
			</div>
			<div class="operand-cell">
				<OperandEditor {store} operand={leaf.right} label="Right" onchange={setRight} />
			</div>
		{:else if isUnaryLeaf(leaf)}
			<div class="operand-cell">
				<OperandEditor
					{store}
					operand={leaf.operand}
					label="Series"
					allowConstant={false}
					onchange={setUnaryOperand}
				/>
			</div>
			<div class="op-cell">
				<Select
					bind:value={() => leaf.op, (v) => changeOperator(v as Operator)}
					options={operatorOptions}
					label="Operator"
				/>
			</div>
			<div class="lookback-cell">
				<NumberInput
					bind:value={() => leaf.lookback, (v) => setLookback(v)}
					min={1}
					step={1}
					suffix="bars"
					label="Lookback"
				/>
			</div>
		{:else if isRangeLeaf(leaf)}
			<div class="operand-cell">
				<OperandEditor {store} operand={leaf.operand} label="Series" onchange={setRangeOperand} />
			</div>
			<div class="op-cell">
				<Select
					bind:value={() => leaf.op, (v) => changeOperator(v as Operator)}
					options={operatorOptions}
					label="Operator"
				/>
			</div>
			<div class="range-cell">
				<OperandEditor {store} operand={leaf.lower} label="Lower bound" onchange={setLower} />
				<span class="range-sep" aria-hidden="true">to</span>
				<OperandEditor {store} operand={leaf.upper} label="Upper bound" onchange={setUpper} />
			</div>
		{/if}

		<div class="delete-cell">
			<IconButton
				label="Delete condition"
				variant="danger"
				size="sm"
				onclick={() => store.removeNode(section, leaf.id)}
			>
				<Trash size={15} />
			</IconButton>
		</div>
	</div>

	{#if errors.length > 0 || warnings.length > 0}
		<ul class="issues">
			{#each errors as issue (issue.path)}
				<li class="err">{issue.message}</li>
			{/each}
			{#each warnings as issue (issue.path)}
				<li class="warn">{issue.message}</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.leaf {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		padding: var(--sp-3);
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
	}
	.leaf.has-error {
		border-color: color-mix(in oklch, var(--c-danger) 45%, var(--c-border));
	}
	.row {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-3);
		align-items: start;
	}
	.op-cell {
		align-self: start;
	}
	.operand-cell,
	.range-cell,
	.lookback-cell {
		min-width: 0;
	}
	.range-cell {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	.range-sep {
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.delete-cell {
		justify-self: end;
	}
	.issues {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: var(--fs-xs);
	}
	.issues .err {
		color: var(--c-danger);
	}
	.issues .warn {
		color: var(--c-warning);
	}

	@media (min-width: 64rem) {
		.row {
			grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.4fr) auto;
			align-items: start;
		}
		.range-cell {
			flex-direction: row;
			align-items: center;
			flex-wrap: wrap;
		}
	}
</style>
