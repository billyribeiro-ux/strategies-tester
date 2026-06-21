<script lang="ts">
	import Field from './Field.svelte';

	interface Option {
		value: string;
		label: string;
	}
	interface Props {
		value?: string;
		options: Option[];
		label?: string;
		hint?: string;
		error?: string;
		required?: boolean;
		placeholder?: string;
		disabled?: boolean;
	}
	let {
		value = $bindable(''),
		options,
		label,
		hint,
		error,
		required = false,
		placeholder,
		disabled = false
	}: Props = $props();
</script>

<Field {label} {hint} {error} {required}>
	{#snippet children({ id, describedBy, invalid })}
		<div class="wrap" class:disabled>
			<select
				{id}
				class="select"
				aria-describedby={describedBy}
				aria-invalid={invalid || undefined}
				{disabled}
				bind:value
			>
				{#if placeholder !== undefined}
					<option value="" disabled>{placeholder}</option>
				{/if}
				{#each options as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			<span class="chevron" aria-hidden="true">▾</span>
		</div>
	{/snippet}
</Field>

<style>
	.wrap {
		position: relative;
		display: flex;
		align-items: center;
	}
	.select {
		appearance: none;
		width: 100%;
		padding: 0.4375rem 2rem 0.4375rem 0.625rem;
		background: var(--c-bg);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		color: var(--c-text);
		cursor: pointer;
		transition: border-color var(--dur-fast) var(--ease);
	}
	.select:focus-visible {
		border-color: var(--c-primary);
	}
	.wrap.disabled {
		opacity: 0.55;
	}
	:global(.field.invalid) .select {
		border-color: var(--c-danger);
	}
	.chevron {
		position: absolute;
		right: 0.625rem;
		pointer-events: none;
		color: var(--c-text-muted);
		font-size: 0.75rem;
	}
</style>
