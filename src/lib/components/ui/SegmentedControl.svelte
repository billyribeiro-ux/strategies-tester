<script lang="ts">
	interface Option {
		value: string;
		label: string;
	}
	interface Props {
		value?: string;
		options: Option[];
		label?: string;
		size?: 'sm' | 'md';
	}
	let { value = $bindable(''), options, label, size = 'md' }: Props = $props();
	const name = $props.id();
</script>

<div class="seg {size}" role="radiogroup" aria-label={label}>
	{#each options as opt (opt.value)}
		<label class="opt" class:active={value === opt.value}>
			<input type="radio" {name} value={opt.value} bind:group={value} />
			<span>{opt.label}</span>
		</label>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		padding: 2px;
		gap: 2px;
		background: var(--c-surface-2);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
	}
	.opt {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: calc(var(--radius) - 2px);
		color: var(--c-text-muted);
		cursor: pointer;
		white-space: nowrap;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.md .opt {
		padding: 0.3125rem 0.75rem;
		font-size: var(--fs-sm);
	}
	.sm .opt {
		padding: 0.1875rem 0.5rem;
		font-size: var(--fs-xs);
	}
	.opt:hover {
		color: var(--c-text);
	}
	.opt.active {
		background: var(--c-surface);
		color: var(--c-text);
		box-shadow: var(--shadow-sm);
	}
	input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	input:focus-visible + span {
		text-decoration: underline;
	}
	.opt:has(input:focus-visible) {
		box-shadow: var(--focus-ring);
	}
</style>
