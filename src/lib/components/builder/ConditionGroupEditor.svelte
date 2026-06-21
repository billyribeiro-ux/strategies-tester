<script lang="ts">
	import type { ConditionGroup, RuleSection } from '$lib/types';
	import { isGroup } from '$lib/validation/guards';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { Badge, Button, IconButton, SegmentedControl } from '$lib/components/ui';
	import { CaretDown, CaretUp, DotsSixVertical, Plus, Stack, Trash } from 'phosphor-svelte';
	import ConditionLeafEditor from './ConditionLeafEditor.svelte';
	import Self from './ConditionGroupEditor.svelte';

	interface Props {
		store: StrategyStore;
		section: RuleSection;
		group: ConditionGroup;
		/** Root group is not removable and not draggable. */
		isRoot?: boolean;
		depth?: number;
	}

	let { store, section, group, isRoot = false, depth = 0 }: Props = $props();

	const logicOptions = [
		{ value: 'AND', label: 'AND' },
		{ value: 'OR', label: 'OR' }
	];

	let dragIndex = $state<number | null>(null);
	let overIndex = $state<number | null>(null);

	function onDragStart(e: DragEvent, index: number) {
		dragIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
	}
	function onDragOver(e: DragEvent, index: number) {
		if (dragIndex === null) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		overIndex = index;
	}
	function onDrop(e: DragEvent, index: number) {
		e.preventDefault();
		if (dragIndex !== null && dragIndex !== index) {
			store.moveNode(section, group.id, dragIndex, index);
		}
		dragIndex = null;
		overIndex = null;
	}
	function onDragEnd() {
		dragIndex = null;
		overIndex = null;
	}

	const childCount = $derived(group.children.length);
</script>

<div class="group" class:root={isRoot} style="--depth:{depth}">
	<header class="group-head">
		<div class="logic">
			{#if childCount > 1}
				<SegmentedControl
					bind:value={
						() => group.logic,
						(v) => store.setGroupLogic(section, group.id, v as 'AND' | 'OR')
					}
					options={logicOptions}
					size="sm"
					label="Group logic"
				/>
				<span class="logic-hint">
					{group.logic === 'AND' ? 'all must be true' : 'any may be true'}
				</span>
			{:else}
				<Badge tone="neutral" size="sm">Group</Badge>
			{/if}
		</div>
		<div class="group-actions">
			<Button size="sm" variant="ghost" onclick={() => store.addLeaf(section, group.id, 'binary')}>
				{#snippet icon()}<Plus size={14} weight="bold" />{/snippet}
				Condition
			</Button>
			<Button size="sm" variant="ghost" onclick={() => store.addGroup(section, group.id)}>
				{#snippet icon()}<Stack size={14} />{/snippet}
				Group
			</Button>
			{#if !isRoot}
				<IconButton
					label="Delete group"
					variant="danger"
					size="sm"
					onclick={() => store.removeNode(section, group.id)}
				>
					<Trash size={15} />
				</IconButton>
			{/if}
		</div>
	</header>

	{#if childCount === 0}
		<p class="empty">No conditions yet. Add a condition or a nested group.</p>
	{:else}
		<ol class="children">
			{#each group.children as child, index (child.id)}
				<li
					class="child"
					class:dragging={dragIndex === index}
					class:drag-over={overIndex === index && dragIndex !== index}
					ondragover={(e) => onDragOver(e, index)}
					ondrop={(e) => onDrop(e, index)}
				>
					<div
						class="handle"
						draggable="true"
						aria-hidden="true"
						title="Drag to reorder"
						ondragstart={(e) => onDragStart(e, index)}
						ondragend={onDragEnd}
					>
						<DotsSixVertical size={16} weight="bold" />
					</div>
					<div class="child-body">
						{#if isGroup(child)}
							<Self {store} {section} group={child} depth={depth + 1} />
						{:else}
							<ConditionLeafEditor {store} {section} leaf={child} />
						{/if}
					</div>
					<div class="reorder">
						<IconButton
							label="Move up"
							size="sm"
							disabled={index === 0}
							onclick={() => store.moveNode(section, group.id, index, index - 1)}
						>
							<CaretUp size={14} weight="bold" />
						</IconButton>
						<IconButton
							label="Move down"
							size="sm"
							disabled={index === childCount - 1}
							onclick={() => store.moveNode(section, group.id, index, index + 1)}
						>
							<CaretDown size={14} weight="bold" />
						</IconButton>
					</div>
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.group:not(.root) {
		padding-left: var(--sp-3);
		border-left: 2px solid var(--c-border-strong);
	}
	.group-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}
	.logic {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}
	.logic-hint {
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
	}
	.group-actions {
		display: flex;
		gap: var(--sp-1);
		align-items: center;
		flex-wrap: wrap;
	}
	.empty {
		font-size: var(--fs-sm);
		color: var(--c-text-faint);
		padding: var(--sp-2) 0;
	}
	.children {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	.child {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: var(--sp-2);
		align-items: start;
		border-radius: var(--radius);
		transition: box-shadow var(--dur-fast) var(--ease);
	}
	.child.dragging {
		opacity: 0.5;
	}
	.child.drag-over {
		box-shadow: 0 0 0 2px var(--c-primary);
	}
	.handle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--sp-2) 0.125rem;
		color: var(--c-text-faint);
		cursor: grab;
		border-radius: var(--radius);
		touch-action: none;
	}
	.handle:hover {
		color: var(--c-text-muted);
		background: var(--c-surface-2);
	}
	.handle:active {
		cursor: grabbing;
	}
	.child-body {
		min-width: 0;
	}
	.reorder {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
</style>
