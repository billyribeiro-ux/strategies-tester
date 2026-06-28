<!--
	Never rendered in practice: the `load` in +page.ts always redirects to
	/backtest. Present only to satisfy SvelteKit's "a +page.ts needs a
	+page.svelte" rule and as a no-JavaScript fallback.
-->
<p class="redirect-note">Redirecting to the strategy builder…</p>

<style>
	.redirect-note {
		max-width: 48rem;
		margin: 0 auto;
		padding: var(--sp-12) var(--sp-4);
		color: var(--c-text-muted);
	}
</style>
