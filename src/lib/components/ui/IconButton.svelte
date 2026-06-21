<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		/** Accessible label — required (icon-only button). */
		label: string;
		variant?: 'default' | 'danger';
		size?: 'sm' | 'md';
		children: Snippet;
	}

	let {
		label,
		variant = 'default',
		size = 'md',
		type = 'button',
		children,
		...rest
	}: Props = $props();
</script>

<button {type} class="icon-btn {variant} {size}" aria-label={label} title={label} {...rest}>
	{@render children()}
</button>

<style>
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: var(--radius);
		color: var(--c-text-muted);
		background: transparent;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.md {
		width: 2rem;
		height: 2rem;
	}
	.sm {
		width: 1.625rem;
		height: 1.625rem;
	}
	.icon-btn:hover:not(:disabled) {
		background: var(--c-surface-2);
		color: var(--c-text);
	}
	.danger:hover:not(:disabled) {
		background: var(--c-danger-soft);
		color: var(--c-danger);
	}
	.icon-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
