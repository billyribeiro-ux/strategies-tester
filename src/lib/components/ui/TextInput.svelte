<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Field from './Field.svelte';

	interface Props extends Omit<HTMLInputAttributes, 'value'> {
		value?: string;
		label?: string;
		hint?: string;
		error?: string;
		required?: boolean;
	}
	let {
		value = $bindable(''),
		label,
		hint,
		error,
		required = false,
		type = 'text',
		...rest
	}: Props = $props();
</script>

<Field {label} {hint} {error} {required}>
	{#snippet children({ id, describedBy, invalid })}
		<input
			{id}
			{type}
			class="input"
			aria-describedby={describedBy}
			aria-invalid={invalid || undefined}
			bind:value
			{...rest}
		/>
	{/snippet}
</Field>

<style>
	.input {
		width: 100%;
		padding: 0.4375rem 0.625rem;
		background: var(--c-bg);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		color: var(--c-text);
		transition: border-color var(--dur-fast) var(--ease);
	}
	.input::placeholder {
		color: var(--c-text-faint);
	}
	.input:focus-visible {
		border-color: var(--c-primary);
	}
	:global(.field.invalid) .input {
		border-color: var(--c-danger);
	}
</style>
