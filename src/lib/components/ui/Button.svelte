<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md';
		loading?: boolean;
		children: Snippet;
		/** Optional leading icon snippet. */
		icon?: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'md',
		loading = false,
		disabled = false,
		type = 'button',
		icon,
		children,
		...rest
	}: Props = $props();
</script>

<button
	{type}
	class="btn {variant} {size}"
	class:loading
	disabled={disabled || loading}
	aria-busy={loading}
	{...rest}
>
	{#if loading}
		<span class="spinner" aria-hidden="true"></span>
	{:else if icon}
		<span class="icon">{@render icon()}</span>
	{/if}
	<span class="label">{@render children()}</span>
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-2);
		border: 1px solid transparent;
		border-radius: var(--radius);
		font-weight: 550;
		white-space: nowrap;
		transition:
			background var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.md {
		padding: 0.5rem 0.875rem;
		font-size: var(--fs-base);
	}
	.sm {
		padding: 0.3125rem 0.625rem;
		font-size: var(--fs-sm);
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.primary {
		background: var(--c-primary);
		color: var(--c-primary-contrast);
	}
	.primary:hover:not(:disabled) {
		background: var(--c-primary-hover);
	}

	.secondary {
		background: var(--c-surface);
		border-color: var(--c-border-strong);
		color: var(--c-text);
	}
	.secondary:hover:not(:disabled) {
		background: var(--c-surface-2);
	}

	.ghost {
		background: transparent;
		color: var(--c-text-muted);
	}
	.ghost:hover:not(:disabled) {
		background: var(--c-surface-2);
		color: var(--c-text);
	}

	.danger {
		background: var(--c-danger);
		color: var(--c-primary-contrast);
	}
	.danger:hover:not(:disabled) {
		filter: brightness(1.05);
	}

	.icon,
	.spinner {
		display: inline-flex;
		flex: none;
	}
	.spinner {
		width: 1em;
		height: 1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
