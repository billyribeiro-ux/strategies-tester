<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tone?: 'info' | 'warning' | 'danger' | 'success';
		title?: string;
		children: Snippet;
		icon?: Snippet;
	}
	let { tone = 'info', title, icon, children }: Props = $props();
</script>

<div class="callout {tone}" role="note">
	{#if icon}<span class="icon">{@render icon()}</span>{/if}
	<div class="content">
		{#if title}<p class="title">{title}</p>{/if}
		<div class="body">{@render children()}</div>
	</div>
</div>

<style>
	.callout {
		display: flex;
		gap: var(--sp-3);
		padding: var(--sp-3) var(--sp-4);
		border-radius: var(--radius);
		border: 1px solid;
		font-size: var(--fs-sm);
	}
	.icon {
		flex: none;
		display: inline-flex;
		margin-top: 1px;
	}
	.title {
		font-weight: 600;
		margin-bottom: 0.125rem;
	}
	.info {
		background: var(--c-primary-soft);
		border-color: color-mix(in oklch, var(--c-primary) 30%, transparent);
		color: var(--c-text);
	}
	.warning {
		background: var(--c-warning-soft);
		border-color: color-mix(in oklch, var(--c-warning) 35%, transparent);
		color: var(--c-text);
	}
	.danger {
		background: var(--c-danger-soft);
		border-color: color-mix(in oklch, var(--c-danger) 35%, transparent);
		color: var(--c-text);
	}
	.success {
		background: var(--c-success-soft);
		border-color: color-mix(in oklch, var(--c-success) 35%, transparent);
		color: var(--c-text);
	}
</style>
