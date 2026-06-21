<script lang="ts">
	import { scaleLinear, scaleTime } from 'd3-scale';
	import { extent, min, bisector } from 'd3-array';
	import type { DrawdownPoint } from '$lib/types';
	import { formatDateTime, formatPercent } from '$lib/utils/format';
	import { chartColors, defaultMargins, niceTicks } from './theme';
	import { EmptyState } from '$lib/components/ui';

	interface Props {
		data: DrawdownPoint[];
		height?: number;
	}
	let { data, height = 200 }: Props = $props();

	const m = defaultMargins;
	const uid = $props.id();
	const gradId = `dd-grad-${uid}`;

	let width = $state(640);
	function track(node: HTMLElement) {
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w && w > 0) width = w;
		});
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	}

	const points = $derived(
		data
			.map((p) => ({ ...p, date: new Date(p.t), value: Math.min(0, p.drawdown) }))
			.filter((p) => !Number.isNaN(p.date.getTime()) && Number.isFinite(p.value))
	);

	const innerW = $derived(Math.max(0, width - m.left - m.right));
	const innerH = $derived(Math.max(0, height - m.top - m.bottom));

	const xScale = $derived(
		scaleTime()
			.domain((extent(points, (p) => p.date) as [Date, Date]) ?? [new Date(), new Date()])
			.range([0, innerW])
	);

	// Domain runs from the deepest drawdown (negative) up to 0.
	const yLow = $derived(Math.min(min(points, (p) => p.value) ?? 0, 0));
	const yScale = $derived(scaleLinear().domain([yLow, 0]).nice().range([innerH, 0]));
	const zeroY = $derived(yScale(0));

	const yTicks = $derived(niceTicks(yScale.domain()[0], 0, 4));
	const xTicks = $derived(xScale.ticks(Math.max(2, Math.floor(innerW / 110))));

	const linePath = $derived(
		points.length
			? 'M' + points.map((p) => `${xScale(p.date).toFixed(2)},${yScale(p.value).toFixed(2)}`).join('L')
			: ''
	);
	const areaPath = $derived(
		points.length
			? `M${xScale(points[0].date).toFixed(2)},${zeroY.toFixed(2)}` +
					'L' +
					points.map((p) => `${xScale(p.date).toFixed(2)},${yScale(p.value).toFixed(2)}`).join('L') +
					`L${xScale(points[points.length - 1].date).toFixed(2)},${zeroY.toFixed(2)}Z`
			: ''
	);

	const maxDrawdown = $derived(min(points, (p) => p.value) ?? 0);

	const bisect = bisector<(typeof points)[number], Date>((p) => p.date).center;
	let hover = $state<{ x: number; y: number; point: (typeof points)[number] } | null>(null);

	function onmove(event: MouseEvent) {
		if (!points.length || innerW <= 0) return;
		const svg = event.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const px = event.clientX - rect.left - m.left;
		const date = xScale.invert(Math.max(0, Math.min(innerW, px)));
		const i = bisect(points, date);
		const p = points[i];
		if (p) hover = { x: xScale(p.date), y: yScale(p.value), point: p };
	}
	function onleave() {
		hover = null;
	}
</script>

<div class="chart" use:track>
	{#if points.length === 0}
		<EmptyState title="No drawdown data" description="This run produced no drawdown series." compact />
	{:else}
		<svg
			{width}
			{height}
			viewBox="0 0 {width} {height}"
			role="img"
			aria-label="Drawdown over time"
			onmousemove={onmove}
			onmouseleave={onleave}
		>
			<title>Drawdown over time. Maximum drawdown {formatPercent(maxDrawdown)}.</title>
			<defs>
				<linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color={chartColors.short} stop-opacity="0.08" />
					<stop offset="100%" stop-color={chartColors.short} stop-opacity="0.42" />
				</linearGradient>
			</defs>
			<g transform="translate({m.left},{m.top})">
				{#each yTicks as tick (tick)}
					<g transform="translate(0,{yScale(tick)})">
						<line x1="0" x2={innerW} class="grid" />
						<text x="-8" dy="0.32em" class="axis-label y">{formatPercent(tick, 1)}</text>
					</g>
				{/each}
				{#each xTicks as tick (tick.getTime())}
					<text x={xScale(tick)} y={innerH + 18} class="axis-label x">
						{tick.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
					</text>
				{/each}

				<path d={areaPath} fill="url(#{gradId})" />
				<path d={linePath} class="line" />
				<line x1="0" x2={innerW} y1={zeroY} y2={zeroY} class="zero" />

				{#if hover}
					<line x1={hover.x} x2={hover.x} y1="0" y2={innerH} class="cursor" />
					<circle cx={hover.x} cy={hover.y} r="3.5" class="dot" />
				{/if}
			</g>
		</svg>

		{#if hover}
			<div
				class="tooltip"
				style:left="{hover.x + m.left}px"
				style:top="{hover.y + m.top}px"
				role="status"
			>
				<span class="t-date">{formatDateTime(hover.point.t)}</span>
				<span class="t-val">{formatPercent(hover.point.value)}</span>
			</div>
		{/if}
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
	.line {
		fill: none;
		stroke: var(--c-short);
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.zero {
		stroke: var(--c-border-strong);
		stroke-width: 1;
		shape-rendering: crispEdges;
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
	.cursor {
		stroke: var(--c-border-strong);
		stroke-width: 1;
		stroke-dasharray: 3 3;
	}
	.dot {
		fill: var(--c-short);
		stroke: var(--c-surface);
		stroke-width: 1.5;
	}
	.tooltip {
		position: absolute;
		transform: translate(-50%, calc(-100% - 10px));
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: var(--sp-1) var(--sp-2);
		background: var(--c-surface);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow);
		white-space: nowrap;
		z-index: var(--z-dropdown);
	}
	.t-date {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
	}
	.t-val {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--c-short);
		font-variant-numeric: tabular-nums;
	}
</style>
