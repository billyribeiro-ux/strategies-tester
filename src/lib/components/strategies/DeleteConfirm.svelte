<script lang="ts">
	import { Modal, Button, Callout } from '$lib/components/ui';
	import { Warning } from 'phosphor-svelte';

	interface Props {
		open?: boolean;
		/** Name shown in the confirmation copy. */
		name: string;
		/** Async deleter — resolves true on success. */
		onConfirm: () => Promise<boolean>;
		onClose: () => void;
	}

	let { open = $bindable(false), name, onConfirm, onClose }: Props = $props();

	let deleting = $state(false);
	let error = $state<string | null>(null);

	function handleClose() {
		if (deleting) return;
		error = null;
		onClose();
	}

	async function confirm() {
		deleting = true;
		error = null;
		const ok = await onConfirm();
		deleting = false;
		if (ok) {
			onClose();
		} else {
			error = 'The strategy could not be deleted. Please try again.';
		}
	}
</script>

<Modal bind:open title="Delete strategy" size="sm" onclose={handleClose}>
	<p class="body">
		Permanently delete <strong>{name}</strong> and all of its saved versions? This cannot be undone.
	</p>
	{#if error}
		<div class="error">
			<Callout tone="danger" title="Delete failed">
				{#snippet icon()}<Warning size={16} weight="fill" />{/snippet}
				{error}
			</Callout>
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={handleClose} disabled={deleting}>Cancel</Button>
		<Button variant="danger" loading={deleting} onclick={confirm}>Delete</Button>
	{/snippet}
</Modal>

<style>
	.body {
		font-size: var(--fs-base);
		color: var(--c-text-muted);
		line-height: var(--lh-normal);
	}
	.body strong {
		color: var(--c-text);
	}
	.error {
		margin-top: var(--sp-4);
	}
</style>
