<script lang="ts">
	interface Props {
		size?: number;
		label?: string;
	}
	let { size = 20, label = 'Loading' }: Props = $props();
</script>

<span
	class="spinner"
	role="status"
	aria-label={label}
	style="width:{size}px;height:{size}px"
></span>

<style>
	.spinner {
		display: inline-block;
		border: 2px solid var(--c-border-strong);
		border-right-color: var(--c-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
