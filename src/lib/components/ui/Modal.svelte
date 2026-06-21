<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'phosphor-svelte';

	interface Props {
		open?: boolean;
		title?: string;
		size?: 'sm' | 'md' | 'lg';
		children: Snippet;
		footer?: Snippet;
		onclose?: () => void;
	}
	let { open = $bindable(false), title, size = 'md', children, footer, onclose }: Props = $props();

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		const el = dialog;
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	});

	function close() {
		open = false;
		onclose?.();
	}
</script>

<dialog
	bind:this={dialog}
	class={size}
	onclose={close}
	onclick={(e) => {
		if (e.target === dialog) close();
	}}
>
	{#if open}
		<div class="panel">
			<header>
				<h2>{title}</h2>
				<button type="button" class="x" aria-label="Close" onclick={close}>
					<X size={18} />
				</button>
			</header>
			<div class="body">{@render children()}</div>
			{#if footer}<footer>{@render footer()}</footer>{/if}
		</div>
	{/if}
</dialog>

<style>
	dialog {
		padding: 0;
		border: none;
		background: transparent;
		max-width: min(94vw, var(--w));
		width: 100%;
		color: var(--c-text);
	}
	.sm {
		--w: 24rem;
	}
	.md {
		--w: 34rem;
	}
	.lg {
		--w: 52rem;
	}
	dialog::backdrop {
		background: oklch(0% 0 0 / 0.5);
		backdrop-filter: blur(2px);
	}
	.panel {
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		overflow: clip;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		padding: var(--sp-4) var(--sp-5);
		border-bottom: 1px solid var(--c-border);
	}
	h2 {
		font-size: var(--fs-md);
	}
	.x {
		display: inline-flex;
		padding: 0.25rem;
		border: none;
		background: transparent;
		color: var(--c-text-muted);
		border-radius: var(--radius);
	}
	.x:hover {
		background: var(--c-surface-2);
		color: var(--c-text);
	}
	.body {
		padding: var(--sp-5);
		overflow: auto;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--sp-2);
		padding: var(--sp-4) var(--sp-5);
		border-top: 1px solid var(--c-border);
	}
</style>
