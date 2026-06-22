<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label?: string;
		hint?: string;
		error?: string;
		required?: boolean;
		/**
		 * Set to true when the labeled element is not a native form control
		 * (e.g. a div with role="radiogroup"). The label's `for` attribute is
		 * omitted and `labelId` is exposed in the snippet so the consumer can
		 * wire up `aria-labelledby` instead.
		 */
		noFor?: boolean;
		/** Receives wiring to apply to the control for a11y. */
		children: Snippet<
			[
				{
					id: string;
					labelId: string | undefined;
					describedBy: string | undefined;
					invalid: boolean;
				}
			]
		>;
	}
	let { label, hint, error, required = false, noFor = false, children }: Props = $props();

	const uid = $props.id();
	const controlId = `${uid}-control`;
	let labelId = $derived(label ? `${uid}-label` : undefined);
	let describedBy = $derived(
		[hint ? `${uid}-hint` : null, error ? `${uid}-error` : null].filter(Boolean).join(' ') ||
			undefined
	);
	let invalid = $derived(Boolean(error));
</script>

<div class="field" class:invalid>
	{#if label}
		<label id={labelId} for={noFor ? undefined : controlId}>
			{label}{#if required}<span class="req" aria-hidden="true">*</span>{/if}
		</label>
	{/if}
	{@render children({ id: controlId, labelId, describedBy, invalid })}
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
