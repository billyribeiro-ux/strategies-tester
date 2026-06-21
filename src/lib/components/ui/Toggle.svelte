<script lang="ts">
	interface Props {
		checked?: boolean;
		label?: string;
		disabled?: boolean;
	}
	let { checked = $bindable(false), label, disabled = false }: Props = $props();
</script>

<label class="toggle" class:disabled>
	<input type="checkbox" role="switch" bind:checked {disabled} />
	<span class="track"><span class="thumb"></span></span>
	{#if label}<span class="lbl">{label}</span>{/if}
</label>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		cursor: pointer;
		font-size: var(--fs-sm);
	}
	.toggle.disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.track {
		position: relative;
		width: 2.25rem;
		height: 1.3rem;
		border-radius: var(--radius-full);
		background: var(--c-surface-3);
		border: 1px solid var(--c-border-strong);
		transition: background var(--dur-fast) var(--ease);
		flex: none;
	}
	.thumb {
		position: absolute;
		top: 50%;
		left: 2px;
		transform: translateY(-50%);
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		background: var(--c-surface);
		box-shadow: var(--shadow-sm);
		transition: left var(--dur-fast) var(--ease);
	}
	input:checked + .track {
		background: var(--c-primary);
		border-color: var(--c-primary);
	}
	input:checked + .track .thumb {
		left: calc(100% - 1rem - 2px);
	}
	input:focus-visible + .track {
		box-shadow: var(--focus-ring);
	}
	.lbl {
		color: var(--c-text);
	}
</style>
