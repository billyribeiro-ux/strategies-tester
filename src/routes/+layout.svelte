<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Nav from '$lib/components/shell/Nav.svelte';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<a class="skip" href="#main">Skip to content</a>

<header class="header">
	<Nav />
</header>

<main id="main" class="main">
	{@render children()}
</main>

<style>
	.skip {
		position: absolute;
		left: var(--sp-2);
		top: var(--sp-2);
		z-index: var(--z-toast);
		padding: var(--sp-2) var(--sp-3);
		background: var(--c-surface);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		color: var(--c-text);
		transform: translateY(-150%);
		transition: transform var(--dur) var(--ease);
	}
	.skip:focus {
		transform: translateY(0);
		text-decoration: none;
	}

	.header {
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
		background: color-mix(in oklch, var(--c-bg) 85%, transparent);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--c-border);
	}

	.main {
		max-width: 80rem;
		margin: 0 auto;
		width: 100%;
		padding: var(--sp-8) var(--sp-4) var(--sp-16);
	}

	@media (max-width: 40rem) {
		.main {
			padding: var(--sp-6) var(--sp-4) var(--sp-12);
		}
	}
</style>
