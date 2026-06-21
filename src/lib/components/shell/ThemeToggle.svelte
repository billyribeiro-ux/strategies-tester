<script lang="ts">
	import { browser } from '$app/environment';
	import { Sun, Moon } from 'phosphor-svelte';

	type Theme = 'light' | 'dark';
	const STORAGE_KEY = 'theme';

	function systemTheme(): Theme {
		if (!browser) return 'light';
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	function storedTheme(): Theme | null {
		if (!browser) return null;
		const saved = localStorage.getItem(STORAGE_KEY);
		return saved === 'light' || saved === 'dark' ? saved : null;
	}

	// Initialise from saved preference, falling back to the system setting.
	let theme = $state<Theme>(storedTheme() ?? systemTheme());

	// Mirror the chosen theme to the DOM + localStorage (browser only).
	$effect(() => {
		if (!browser) return;
		document.documentElement.dataset.theme = theme;
		localStorage.setItem(STORAGE_KEY, theme);
	});

	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
	}

	let isDark = $derived(theme === 'dark');
</script>

<button
	type="button"
	class="toggle"
	role="switch"
	aria-checked={isDark}
	aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
	title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
	onclick={toggle}
>
	{#if isDark}
		<Moon size={18} weight="fill" />
	{:else}
		<Sun size={18} weight="fill" />
	{/if}
</button>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		background: var(--c-surface);
		color: var(--c-text-muted);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}
	.toggle:hover {
		background: var(--c-surface-2);
		color: var(--c-text);
	}
</style>
