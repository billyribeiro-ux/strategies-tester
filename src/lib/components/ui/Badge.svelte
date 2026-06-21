<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tone?: 'neutral' | 'primary' | 'long' | 'short' | 'warning' | 'accent';
		size?: 'sm' | 'md';
		children: Snippet;
	}
	let { tone = 'neutral', size = 'md', children }: Props = $props();
</script>

<span class="badge {tone} {size}">{@render children()}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border-radius: var(--radius-full);
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
	}
	.md {
		padding: 0.25rem 0.5rem;
		font-size: var(--fs-xs);
	}
	.sm {
		padding: 0.125rem 0.375rem;
		font-size: 0.6875rem;
	}
	.neutral {
		background: var(--c-surface-3);
		color: var(--c-text-muted);
	}
	.primary {
		background: var(--c-primary-soft);
		color: var(--c-primary);
	}
	.long {
		background: var(--c-long-soft);
		color: var(--c-long);
	}
	.short {
		background: var(--c-short-soft);
		color: var(--c-short);
	}
	.warning {
		background: var(--c-warning-soft);
		color: var(--c-warning);
	}
	.accent {
		background: color-mix(in oklch, var(--c-accent) 18%, transparent);
		color: var(--c-accent);
	}
</style>
