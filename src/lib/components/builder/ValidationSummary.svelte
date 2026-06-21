<script lang="ts">
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import type { SpecIssue } from '$lib/validation';
	import { Callout } from '$lib/components/ui';
	import { CheckCircle, WarningCircle } from 'phosphor-svelte';

	interface Props {
		store: StrategyStore;
	}

	let { store }: Props = $props();

	// Errors first, then warnings, preserving discovery order within each group.
	const ordered = $derived<SpecIssue[]>([
		...store.issues.filter((i) => i.severity === 'error'),
		...store.issues.filter((i) => i.severity === 'warning')
	]);

	const tone = $derived<'danger' | 'warning' | 'success'>(
		store.errorCount > 0 ? 'danger' : store.warningCount > 0 ? 'warning' : 'success'
	);

	const heading = $derived(
		store.errorCount > 0
			? `${store.errorCount} ${store.errorCount === 1 ? 'error' : 'errors'}${store.warningCount > 0 ? ` · ${store.warningCount} ${store.warningCount === 1 ? 'warning' : 'warnings'}` : ''}`
			: store.warningCount > 0
				? `${store.warningCount} ${store.warningCount === 1 ? 'warning' : 'warnings'}`
				: 'Ready to run'
	);
</script>

{#if ordered.length === 0}
	<Callout tone="success" title="Ready to run">
		{#snippet icon()}<CheckCircle size={16} weight="fill" />{/snippet}
		Your strategy passes validation. Run a backtest to see the results.
	</Callout>
{:else}
	<Callout {tone} title={heading}>
		{#snippet icon()}<WarningCircle size={16} weight="fill" />{/snippet}
		<p class="lead">
			{store.errorCount > 0
				? 'Fix the errors below before running a backtest.'
				: 'Warnings will not block the run, but review them.'}
		</p>
		<ul class="issues">
			{#each ordered as issue (issue.path + issue.message)}
				<li class="issue {issue.severity}">
					<span class="sev">{issue.severity === 'error' ? 'Error' : 'Warning'}</span>
					<span class="msg">{issue.message}</span>
					<code class="path">{issue.path}</code>
				</li>
			{/each}
		</ul>
	</Callout>
{/if}

<style>
	.lead {
		margin-bottom: var(--sp-2);
	}
	.issues {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	.issue {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.125rem var(--sp-2);
		align-items: baseline;
	}
	.sev {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-full);
		white-space: nowrap;
	}
	.issue.error .sev {
		background: var(--c-danger-soft);
		color: var(--c-danger);
	}
	.issue.warning .sev {
		background: var(--c-warning-soft);
		color: var(--c-warning);
	}
	.msg {
		font-size: var(--fs-sm);
	}
	.path {
		grid-column: 2;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
	}
</style>
