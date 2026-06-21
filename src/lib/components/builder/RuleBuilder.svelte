<script lang="ts">
	import type { RuleSection } from '$lib/types';
	import { RULE_SECTIONS } from '$lib/types';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { Panel } from '$lib/components/ui';
	import { SignIn, SignOut, TrendDown, TrendUp } from 'phosphor-svelte';
	import ConditionGroupEditor from './ConditionGroupEditor.svelte';

	interface Props {
		store: StrategyStore;
	}

	let { store }: Props = $props();

	interface SectionMeta {
		section: RuleSection;
		title: string;
		side: 'long' | 'short';
		direction: 'entry' | 'exit';
	}

	const SECTION_META: Record<RuleSection, SectionMeta> = {
		longEntry: { section: 'longEntry', title: 'Long entry', side: 'long', direction: 'entry' },
		longExit: { section: 'longExit', title: 'Long exit', side: 'long', direction: 'exit' },
		shortEntry: { section: 'shortEntry', title: 'Short entry', side: 'short', direction: 'entry' },
		shortExit: { section: 'shortExit', title: 'Short exit', side: 'short', direction: 'exit' }
	};
</script>

<div class="rules">
	{#each RULE_SECTIONS as section (section)}
		{@const meta = SECTION_META[section]}
		<div class="section {meta.side}">
			<Panel title={meta.title}>
				{#snippet icon()}
					{#if meta.side === 'long' && meta.direction === 'entry'}
						<TrendUp size={18} weight="bold" color="var(--c-long)" />
					{:else if meta.side === 'long'}
						<SignOut size={18} color="var(--c-long)" />
					{:else if meta.direction === 'entry'}
						<TrendDown size={18} weight="bold" color="var(--c-short)" />
					{:else}
						<SignIn size={18} color="var(--c-short)" />
					{/if}
				{/snippet}
				<ConditionGroupEditor
					{store}
					{section}
					group={store.spec.rules[section]}
					isRoot
				/>
			</Panel>
		</div>
	{/each}
</div>

<style>
	.rules {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-4);
	}
	.section {
		min-width: 0;
		border-radius: var(--radius-lg);
	}
	.section.long {
		box-shadow: inset 3px 0 0 var(--c-long);
		border-radius: var(--radius-lg);
	}
	.section.short {
		box-shadow: inset 3px 0 0 var(--c-short);
		border-radius: var(--radius-lg);
	}

	@media (min-width: 64rem) {
		.rules {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
