<script lang="ts">
	import { scaleLinear } from 'd3-scale';
	import { max as d3max } from 'd3-array';
	import type { DistributionBin } from '$lib/types';
	import { formatInt, formatPercent } from '$lib/utils/format';
	import { colorForSign, defaultMargins, niceTicks } from './theme';
	import { EmptyState } from '$lib/components/ui';

	interface Props {
		data: DistributionBin[];
		height?: number;
	}
	let { data, height = 240 }: Props = $props();

	const m = { ...defaultMargins, bottom: 34 };

	let width = $state(640);
	function track(node: HTMLElement) {
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w && w > 0) width = w;
		});
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	}

	const bins = $derived(
		data.map((b, i) => ({ ...b, i, center: (b.lower + b.upper) / 2 }))
	);

	const innerW = $derived(Math.max(0, width - m.left - m.right));
	const innerH = $derived(Math.max(0, height - m.top - m.bottom));

	const domainLo = $derived(bins.length ? bins[0].lower : 0);
	const domainHi = $derived(bins.length ? bins[bins.length - 1].upper : 1);
	const xScale = $derived(scaleLinear().domain([domainLo, domainHi]).range([0, innerW]));

	const yMax = $derived(d3max(bins, (b) => b.count) ?? 1);
	const yScale = $derived(scaleLinear().domain([0, yMax]).nice().range([innerH, 0]));

	const yTicks = $derived(niceTicks(0, yScale.domain()[1], 4));
	const gap = 1.5;

	const zeroX = $derived(
		domainLo <= 0 && domainHi >= 0 ? xScale(0) : null
	);

	let hover = $state<number | null>(null);
</script>

<div class="chart" use:track>
	{#if bins.length === 0}
		<EmptyState title="No distribution" description="This run produced no trade distribution." compact />
	{:else}
		<svg
			{width}
			{height}
			viewBox="0 0 {width} {height}"
			role="img"
			aria-label="Distribution of trade returns"
		>
			<title>Histogram of trade returns across {bins.length} buckets.</title>
			<g transform="translate({m.left},{m.top})">
				{#each yTicks as tick (tick)}
					<g transform="translate(0,{yScale(tick)})">
						<line x1="0" x2={innerW} class="grid" />
						<text x="-8" dy="0.32em" class="axis-label y">{formatInt(tick)}</text>
					</g>
				{/each}

				{#each bins as b (b.i)}
					{@const x0 = xScale(b.lower)}
					{@const x1 = xScale(b.upper)}
					{@const bw = Math.max(0, x1 - x0 - gap)}
					{@const y = yScale(b.count)}
					<rect
						x={x0 + gap / 2}
						y={y}
						width={bw}
						height={Math.max(0, innerH - y)}
						rx="1.5"
						fill={colorForSign(b.center)}
						opacity={hover === null || hover === b.i ? 0.9 : 0.45}
						role="graphics-symbol"
						aria-label="{formatPercent(b.lower, 1)} to {formatPercent(b.upper, 1)}: {formatInt(
							b.count
						)} trades"
						onmouseenter={() => (hover = b.i)}
						onmouseleave={() => (hover = null)}
					>
						<title
							>{formatPercent(b.lower, 1)} to {formatPercent(b.upper, 1)}: {formatInt(b.count)} trades</title
						>
					</rect>
					{#if hover === b.i}
						<text x={(x0 + x1) / 2} y={y - 6} class="count-label">{formatInt(b.count)}</text>
					{/if}
				{/each}

				<!-- x axis ticks at a few bin edges -->
				{#each bins as b, i (b.i)}
					{#if i % Math.ceil(bins.length / 6) === 0 || i === bins.length - 1}
						<text x={xScale(b.lower)} y={innerH + 16} class="axis-label x">
							{formatPercent(b.lower, 0)}
						</text>
					{/if}
				{/each}

				{#if zeroX !== null}
					<line x1={zeroX} x2={zeroX} y1="0" y2={innerH} class="zero" />
					<text x={zeroX} y={innerH + 30} class="zero-label">0%</text>
				{/if}
			</g>
		</svg>
	{/if}
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}
	.grid {
		stroke: var(--c-border);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}
	rect {
		transition: opacity var(--dur-fast) var(--ease);
		cursor: pointer;
	}
	.axis-label {
		fill: var(--c-text-faint);
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
	}
	.axis-label.y {
		text-anchor: end;
	}
	.axis-label.x {
		text-anchor: middle;
	}
	.count-label {
		fill: var(--c-text);
		font-size: var(--fs-xs);
		font-weight: 600;
		text-anchor: middle;
		font-variant-numeric: tabular-nums;
	}
	.zero {
		stroke: var(--c-border-strong);
		stroke-width: 1.5;
		shape-rendering: crispEdges;
	}
	.zero-label {
		fill: var(--c-text-muted);
		font-size: var(--fs-xs);
		font-weight: 600;
		text-anchor: middle;
	}
</style>
