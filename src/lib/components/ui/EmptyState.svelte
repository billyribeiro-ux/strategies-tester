<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		icon?: Snippet;
		action?: Snippet;
		compact?: boolean;
	}
	let { title, description, icon, action, compact = false }: Props = $props();
</script>

<div class="empty" class:compact>
	{#if icon}<div class="icon">{@render icon()}</div>{/if}
	<p class="title">{title}</p>
	{#if description}<p class="desc">{description}</p>{/if}
	{#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--sp-2);
		padding: var(--sp-12) var(--sp-6);
		color: var(--c-text-muted);
	}
	.empty.compact {
		padding: var(--sp-6) var(--sp-4);
	}
	.icon {
		display: inline-flex;
		color: var(--c-text-faint);
		margin-bottom: var(--sp-1);
	}
	.title {
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--c-text);
	}
	.desc {
		max-width: 36ch;
		font-size: var(--fs-sm);
	}
	.action {
		margin-top: var(--sp-3);
	}
</style>
