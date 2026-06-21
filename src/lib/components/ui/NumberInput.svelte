<script lang="ts">
	import Field from './Field.svelte';

	interface Props {
		value?: number;
		label?: string;
		hint?: string;
		error?: string;
		required?: boolean;
		min?: number;
		max?: number;
		step?: number;
		placeholder?: string;
		disabled?: boolean;
		/** Small inline suffix, e.g. "%" or "bars". */
		suffix?: string;
	}
	let {
		value = $bindable(0),
		label,
		hint,
		error,
		required = false,
		min,
		max,
		step,
		placeholder,
		disabled = false,
		suffix
	}: Props = $props();

	function onInput(e: Event & { currentTarget: HTMLInputElement }) {
		const n = e.currentTarget.valueAsNumber;
		// Keep the previous value while the field is empty/intermediate so the
		// user can clear and retype without the value snapping back.
		if (!Number.isNaN(n)) value = n;
	}
</script>

<Field {label} {hint} {error} {required}>
	{#snippet children({ id, describedBy, invalid })}
		<div class="wrap" class:disabled>
			<input
				{id}
				type="number"
				class="input"
				inputmode="decimal"
				{min}
				{max}
				{step}
				{placeholder}
				{disabled}
				aria-describedby={describedBy}
				aria-invalid={invalid || undefined}
				value={Number.isFinite(value) ? value : ''}
				oninput={onInput}
			/>
			{#if suffix}<span class="suffix">{suffix}</span>{/if}
		</div>
	{/snippet}
</Field>

<style>
	.wrap {
		display: flex;
		align-items: center;
		background: var(--c-bg);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		transition: border-color var(--dur-fast) var(--ease);
	}
	.wrap:focus-within {
		border-color: var(--c-primary);
	}
	.wrap.disabled {
		opacity: 0.55;
	}
	:global(.field.invalid) .wrap {
		border-color: var(--c-danger);
	}
	.input {
		width: 100%;
		padding: 0.4375rem 0.625rem;
		background: transparent;
		border: none;
		color: var(--c-text);
		font-variant-numeric: tabular-nums;
	}
	.input:focus-visible {
		outline: none;
		box-shadow: none;
	}
	.suffix {
		padding-right: 0.625rem;
		font-size: var(--fs-sm);
		color: var(--c-text-faint);
		white-space: nowrap;
	}
</style>
