<script lang="ts">
	import { page } from '$app/state';
	import { Warning } from 'phosphor-svelte';

	// Global error boundary: rendered for any unmatched URL (e.g. /backtest.json)
	// or error thrown in a page `load`. The HTTP status is preserved — a missing
	// resource stays a 404 — but the user sees a branded, navigable page instead
	// of the framework's bare fallback.
	const status = $derived(page.status);
	const isNotFound = $derived(status === 404);
	const heading = $derived(isNotFound ? 'Page not found' : 'Something went wrong');
	const message = $derived(page.error?.message ?? 'An unexpected error occurred.');
</script>

<svelte:head>
	<title>{status} · Strategy Tester</title>
</svelte:head>

<main class="error-page">
	<span class="glyph" aria-hidden="true"><Warning size={28} weight="duotone" /></span>
	<p class="status">{status}</p>
	<h1>{heading}</h1>
	<p class="message">
		{#if isNotFound}
			We couldn’t find <code>{page.url.pathname}</code>. It may have moved, or never
			existed.
		{:else}
			{message}
		{/if}
	</p>
	<div class="actions">
		<a class="btn primary" href="/">Back to home</a>
		<a class="btn" href="/backtest">Open the builder</a>
	</div>
</main>

<style>
	.error-page {
		max-width: 34rem;
		margin: 0 auto;
		padding: var(--sp-16) var(--sp-4);
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--sp-3);
	}
	.glyph {
		display: inline-flex;
		color: var(--c-warning, var(--c-primary));
	}
	.status {
		font-size: var(--fs-sm);
		font-weight: 600;
		letter-spacing: 0.08em;
		color: var(--c-text-muted);
		font-variant-numeric: tabular-nums;
	}
	h1 {
		font-size: var(--fs-2xl);
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.message {
		color: var(--c-text-muted);
		line-height: var(--lh-normal);
	}
	.message code {
		font-family: var(--font-mono, monospace);
		font-size: 0.9em;
		padding: 0 var(--sp-1);
		border-radius: var(--radius-sm, 4px);
		background: color-mix(in oklch, var(--c-text) 8%, transparent);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-3);
		margin-top: var(--sp-4);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		padding: var(--sp-2) var(--sp-4);
		border-radius: var(--radius-md, 8px);
		border: 1px solid var(--c-border);
		font-size: var(--fs-sm);
		font-weight: 550;
		color: var(--c-text);
		background: var(--c-surface);
	}
	.btn:hover {
		border-color: var(--c-primary);
		color: var(--c-primary);
	}
	.btn.primary {
		background: var(--c-primary);
		border-color: var(--c-primary);
		color: var(--c-on-primary, white);
	}
	.btn.primary:hover {
		color: var(--c-on-primary, white);
		filter: brightness(1.05);
	}
</style>
