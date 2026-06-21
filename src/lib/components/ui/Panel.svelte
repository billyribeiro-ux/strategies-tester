<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		description?: string;
		/** Header-right area (actions). */
		actions?: Snippet;
		/** Optional leading icon for the title. */
		icon?: Snippet;
		children: Snippet;
	}
	let { title, description, actions, icon, children }: Props = $props();
</script>

<section class="panel">
	{#if title || actions}
		<header class="head">
			<div class="titles">
				{#if icon}<span class="icon">{@render icon()}</span>{/if}
				<div>
					{#if title}<h2>{title}</h2>{/if}
					{#if description}<p>{description}</p>{/if}
				</div>
			</div>
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class="body">{@render children()}</div>
</section>

<style>
	.panel {
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
		overflow: clip;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--sp-4);
		padding: var(--sp-4) var(--sp-5);
		border-bottom: 1px solid var(--c-border);
	}
	.titles {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
	}
	.icon {
		display: inline-flex;
		color: var(--c-text-muted);
	}
	h2 {
		font-size: var(--fs-md);
		font-weight: 600;
	}
	p {
		margin-top: 0.125rem;
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
	.actions {
		display: flex;
		gap: var(--sp-2);
		flex: none;
	}
	.body {
		padding: var(--sp-5);
	}
</style>
