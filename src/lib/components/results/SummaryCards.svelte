<script lang="ts">
	import type { MetricGroup, MetricValue } from '$lib/types';
	import { formatMetric } from '$lib/utils/format';
	import { EmptyState } from '$lib/components/ui';

	interface Props {
		metrics: MetricValue[];
	}
	let { metrics }: Props = $props();

	// Group order is fixed for layout; group labels are presentational.
	const GROUP_ORDER: MetricGroup[] = ['returns', 'risk', 'trade'];
	const GROUP_LABELS: Record<MetricGroup, string> = {
		returns: 'Returns',
		risk: 'Risk',
		trade: 'Trade stats'
	};

	// Data-driven: iterate whatever metrics the backend reports.
	const groups = $derived(
		GROUP_ORDER.map((group) => ({
			group,
			label: GROUP_LABELS[group],
			items: metrics.filter((m) => m.group === group)
		})).filter((g) => g.items.length > 0)
	);

	/**
	 * Sentiment of a metric for tinting: a metric where higher is better is
	 * "good" when its value is positive, "bad" when negative (and vice-versa for
	 * lower-is-better). Metrics with no `betterWhenHigher` stay neutral.
	 */
	function sentiment(m: MetricValue): 'good' | 'bad' | 'neutral' {
		if (m.betterWhenHigher === undefined || m.value === 0 || !Number.isFinite(m.value)) {
			return 'neutral';
		}
		const positive = m.value > 0;
		const goodWhenPositive = m.betterWhenHigher;
		return positive === goodWhenPositive ? 'good' : 'bad';
	}
</script>

{#if groups.length === 0}
	<EmptyState
		title="No metrics"
		description="This run did not report any summary metrics."
		compact
	/>
{:else}
	<div class="groups">
		{#each groups as g (g.group)}
			<section class="group" aria-labelledby="grp-{g.group}">
				<h3 id="grp-{g.group}" class="group-title">{g.label}</h3>
				<div class="grid">
					{#each g.items as m (m.id)}
						<div class="card" title={m.description}>
							<span class="label">{m.label}</span>
							<span class="value {sentiment(m)}">{formatMetric(m.value, m.format)}</span>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
{/if}

<style>
	.groups {
		display: flex;
		flex-direction: column;
		gap: var(--sp-5);
	}
	.group-title {
		font-size: var(--fs-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--c-text-muted);
		margin-bottom: var(--sp-3);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: var(--sp-3);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		padding: var(--sp-3) var(--sp-4);
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-sm);
	}
	.label {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
		font-weight: 550;
	}
	.value {
		font-size: var(--fs-xl);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		line-height: var(--lh-tight);
		color: var(--c-text);
	}
	.value.good {
		color: var(--c-long);
	}
	.value.bad {
		color: var(--c-short);
	}
</style>
