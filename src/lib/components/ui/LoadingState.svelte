<script lang="ts">
	import Spinner from './Spinner.svelte';

	interface Props {
		label?: string;
		compact?: boolean;
	}
	let { label = 'Loading…', compact = false }: Props = $props();
</script>

<div class="loading" class:compact>
	<Spinner size={compact ? 18 : 24} {label} />
	<p>{label}</p>
</div>

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-3);
		padding: var(--sp-12) var(--sp-6);
		color: var(--c-text-muted);
		font-size: var(--fs-sm);
	}
	.loading.compact {
		padding: var(--sp-6);
	}
</style>
