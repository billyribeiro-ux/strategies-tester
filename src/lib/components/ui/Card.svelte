<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		padding?: 'none' | 'sm' | 'md';
		children: Snippet;
	}
	let { padding = 'md', children }: Props = $props();
</script>

<div class="card pad-{padding}">{@render children()}</div>

<style>
	.card {
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}
	.pad-md {
		padding: var(--sp-5);
	}
	.pad-sm {
		padding: var(--sp-3);
	}
	.pad-none {
		padding: 0;
	}
</style>
