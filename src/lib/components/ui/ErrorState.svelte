<script lang="ts">
	import { Warning } from 'phosphor-svelte';
	import Button from './Button.svelte';

	interface Props {
		title?: string;
		message?: string;
		onRetry?: () => void;
	}
	let { title = 'Something went wrong', message, onRetry }: Props = $props();
</script>

<div class="error" role="alert">
	<span class="icon"><Warning size={28} weight="fill" /></span>
	<p class="title">{title}</p>
	{#if message}<p class="msg">{message}</p>{/if}
	{#if onRetry}
		<div class="action"><Button variant="secondary" size="sm" onclick={onRetry}>Try again</Button></div>
	{/if}
</div>

<style>
	.error {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--sp-2);
		padding: var(--sp-10) var(--sp-6);
	}
	.icon {
		color: var(--c-danger);
	}
	.title {
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.msg {
		max-width: 40ch;
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
	.action {
		margin-top: var(--sp-3);
	}
</style>
