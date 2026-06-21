<script lang="ts">
	import { page } from '$app/state';
	import { ChartLineUp } from 'phosphor-svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	interface NavLink {
		href: string;
		label: string;
	}

	const links: readonly NavLink[] = [
		{ href: '/', label: 'Home' },
		{ href: '/backtest', label: 'Builder' },
		{ href: '/strategies', label: 'Strategies' },
		{ href: '/settings', label: 'Settings' }
	];

	/** A link is active when the path matches exactly, or is a sub-path
	 *  (for non-root links so '/strategies/x' still highlights Strategies). */
	function isActive(href: string, pathname: string): boolean {
		if (href === '/') return pathname === '/';
		return pathname === href || pathname.startsWith(href + '/');
	}
</script>

<nav class="nav" aria-label="Primary">
	<a class="brand" href="/" aria-label="Strategy Tester — home">
		<span class="brand-icon"><ChartLineUp size={22} weight="duotone" /></span>
		<span class="brand-text">Strategy Tester</span>
	</a>

	<ul class="links">
		{#each links as link (link.href)}
			{@const active = isActive(link.href, page.url.pathname)}
			<li>
				<a class="link" class:active href={link.href} aria-current={active ? 'page' : undefined}>
					{link.label}
				</a>
			</li>
		{/each}
	</ul>

	<div class="end">
		<ThemeToggle />
	</div>
</nav>

<style>
	.nav {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		height: var(--header-h);
		padding: 0 var(--sp-4);
		max-width: 80rem;
		margin: 0 auto;
		width: 100%;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		color: var(--c-text);
		font-weight: 650;
		font-size: var(--fs-md);
		flex: none;
	}
	.brand:hover {
		text-decoration: none;
	}
	.brand-icon {
		display: inline-flex;
		color: var(--c-primary);
	}

	.links {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		list-style: none;
		padding: 0;
		margin: 0 auto 0 var(--sp-4);
		flex-wrap: wrap;
	}

	.link {
		display: inline-flex;
		align-items: center;
		padding: 0.375rem var(--sp-3);
		border-radius: var(--radius);
		color: var(--c-text-muted);
		font-weight: 550;
		font-size: var(--fs-base);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.link:hover {
		background: var(--c-surface-2);
		color: var(--c-text);
		text-decoration: none;
	}
	.link.active {
		background: var(--c-primary-soft);
		color: var(--c-primary);
	}

	.end {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		flex: none;
	}

	@media (max-width: 40rem) {
		.brand-text {
			display: none;
		}
		.links {
			margin-left: var(--sp-2);
			gap: 0;
		}
		.link {
			padding: 0.375rem var(--sp-2);
		}
	}
</style>
