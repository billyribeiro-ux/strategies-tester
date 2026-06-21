<script lang="ts">
	import { goto } from '$app/navigation';
	import { Sliders, ChartBar, Export, Plus, FolderOpen } from 'phosphor-svelte';
	import { Button, Card } from '$lib/components/ui';

	interface Feature {
		icon: typeof Sliders;
		title: string;
		body: string;
	}

	const features: readonly Feature[] = [
		{
			icon: Sliders,
			title: 'Visual builder',
			body: 'Compose entry and exit rules from indicators, price, and nestable AND/OR groups — no code, no ambiguity.'
		},
		{
			icon: ChartBar,
			title: 'Institutional analytics',
			body: 'Equity curve, drawdown, monthly returns, trade ledger, and risk metrics — derived straight from results.'
		},
		{
			icon: Export,
			title: 'Lossless export',
			body: 'Every strategy is one canonical JSON spec. Export, version, and re-import with zero contract drift.'
		}
	];
</script>

<section class="hero">
	<p class="eyebrow">Point-in-time backtesting</p>
	<h1>Strategy Tester</h1>
	<p class="tagline">
		Design, backtest, and analyze trading strategies — point-in-time, no look-ahead.
	</p>

	<div class="cta">
		<Button variant="primary" onclick={() => goto('/backtest')}>
			{#snippet icon()}<Plus size={16} weight="bold" />{/snippet}
			New strategy
		</Button>
		<Button variant="secondary" onclick={() => goto('/strategies')}>
			{#snippet icon()}<FolderOpen size={16} />{/snippet}
			My strategies
		</Button>
	</div>
</section>

<section class="features" aria-label="Features">
	{#each features as feature (feature.title)}
		{@const Icon = feature.icon}
		<Card>
			<div class="feature">
				<span class="feature-icon"><Icon size={24} weight="duotone" /></span>
				<h2>{feature.title}</h2>
				<p>{feature.body}</p>
			</div>
		</Card>
	{/each}
</section>

<style>
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--sp-3);
		padding: var(--sp-12) var(--sp-4) var(--sp-10);
		max-width: 44rem;
		margin: 0 auto;
	}
	.eyebrow {
		font-size: var(--fs-sm);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--c-primary);
	}
	h1 {
		font-size: var(--fs-3xl);
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.tagline {
		font-size: var(--fs-lg);
		color: var(--c-text-muted);
		max-width: 38rem;
	}
	.cta {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-3);
		margin-top: var(--sp-4);
	}

	.features {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--sp-4);
		max-width: 64rem;
		margin: 0 auto;
	}
	.feature {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	.feature-icon {
		display: inline-flex;
		color: var(--c-primary);
		margin-bottom: var(--sp-1);
	}
	.feature h2 {
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.feature p {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		line-height: var(--lh-normal);
	}

	@media (max-width: 64rem) {
		.features {
			grid-template-columns: 1fr;
			max-width: 28rem;
		}
	}
	@media (max-width: 40rem) {
		.hero {
			padding-top: var(--sp-8);
		}
		h1 {
			font-size: var(--fs-2xl);
		}
		.tagline {
			font-size: var(--fs-md);
		}
	}
</style>
