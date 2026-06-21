<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label?: string;
		hint?: string;
		error?: string;
		required?: boolean;
		/** Receives wiring to apply to the control for a11y. */
		children: Snippet<[{ id: string; describedBy: string | undefined; invalid: boolean }]>;
	}
	let { label, hint, error, required = false, children }: Props = $props();

	const uid = $props.id();
	const controlId = `${uid}-control`;
	let describedBy = $derived(
		[hint ? `${uid}-hint` : null, error ? `${uid}-error` : null].filter(Boolean).join(' ') ||
			undefined
	);
	let invalid = $derived(Boolean(error));
</script>

<div class="field" class:invalid>
	{#if label}
		<label for={controlId}>
			{label}{#if required}<span class="req" aria-hidden="true">*</span>{/if}
		</label>
	{/if}
	{@render children({ id: controlId, describedBy, invalid })}
	{#if error}
		<p class="msg error" id="{uid}-error">{error}</p>
	{:else if hint}
		<p class="msg hint" id="{uid}-hint">{hint}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		min-width: 0;
	}
	label {
		font-size: var(--fs-sm);
		font-weight: 550;
		color: var(--c-text-muted);
	}
	.req {
		color: var(--c-danger);
		margin-left: 2px;
	}
	.msg {
		font-size: var(--fs-xs);
	}
	.hint {
		color: var(--c-text-faint);
	}
	.error {
		color: var(--c-danger);
	}
</style>
