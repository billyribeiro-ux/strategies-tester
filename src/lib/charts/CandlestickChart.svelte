<script lang="ts">
	import { scaleLinear } from 'd3-scale';
	import { max as d3max, min as d3min } from 'd3-array';
	import type { Candle, TradeMarker } from '$lib/types';
	import { formatCurrency, formatDateTime, formatInt } from '$lib/utils/format';
	import { chartColors, defaultMargins, downsample, niceTicks } from './theme';
	import { EmptyState } from '$lib/components/ui';

	interface Props {
		candles: Candle[];
		markers?: TradeMarker[];
		height?: number;
		/** Maximum candles to draw before downsampling for performance. */
		maxCandles?: number;
	}
	let { candles, markers = [], height = 360, maxCandles = 1500 }: Props = $props();

	const m = { ...defaultMargins, right: 24 };

	let width = $state(720);
	function track(node: HTMLElement) {
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w && w > 0) width = w;
		});
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	}

	const parsed = $derived(
		candles
			.map((c) => ({ ...c, date: new Date(c.t) }))
			.filter((c) => !Number.isNaN(c.date.getTime()))
			.sort((a, b) => a.date.getTime() - b.date.getTime())
	);

	// Downsample if we exceed the cap so rendering stays smooth.
	const view = $derived(downsample(parsed, maxCandles));
	const downsampled = $derived(parsed.length > maxCandles);

	const innerW = $derived(Math.max(0, width - m.left - m.right));
	const innerH = $derived(Math.max(0, height - m.top - m.bottom));

	// Index-based x scale so candles are evenly spaced (no weekend gaps).
	const xScale = $derived(
		scaleLinear()
			.domain([0, Math.max(1, view.length - 1)])
			.range([0, innerW])
	);
	const indexByT = $derived(new Map(view.map((c, i) => [c.t, i])));

	const yLow = $derived(d3min(view, (c) => c.l) ?? 0);
	const yHigh = $derived(d3max(view, (c) => c.h) ?? 1);
	const yScale = $derived(scaleLinear().domain([yLow, yHigh]).nice().range([innerH, 0]));

	const yTicks = $derived(niceTicks(yScale.domain()[0], yScale.domain()[1], 5));
	const candleW = $derived(Math.max(1, Math.min(14, (innerW / Math.max(1, view.length)) * 0.7)));

	const xTickIdx = $derived(
		(() => {
			const n = Math.max(2, Math.floor(innerW / 110));
			const step = Math.max(1, Math.floor((view.length - 1) / n));
			const out: number[] = [];
			for (let i = 0; i < view.length; i += step) out.push(i);
			if (out[out.length - 1] !== view.length - 1 && view.length > 0) out.push(view.length - 1);
			return out;
		})()
	);

	interface PlacedMarker extends TradeMarker {
		x: number;
		y: number;
	}
	// Map each marker to the nearest visible candle index by timestamp.
	const placedMarkers = $derived(
		(() => {
			if (!view.length) return [] as PlacedMarker[];
			const times = view.map((c) => c.date.getTime());
			return markers
				.map((mk) => {
					const exact = indexByT.get(mk.t);
					let idx: number;
					if (exact !== undefined) {
						idx = exact;
					} else {
						const target = new Date(mk.t).getTime();
						if (Number.isNaN(target)) return null;
						// nearest candle by time
						let best = 0;
						let bestDist = Infinity;
						for (let i = 0; i < times.length; i++) {
							const d = Math.abs(times[i] - target);
							if (d < bestDist) {
								bestDist = d;
								best = i;
							}
						}
						idx = best;
					}
					return { ...mk, x: xScale(idx), y: yScale(mk.price) } as PlacedMarker;
				})
				.filter((mk): mk is PlacedMarker => mk !== null);
		})()
	);

	let hover = $state<{ x: number; candle: (typeof view)[number] } | null>(null);
	function onmove(event: MouseEvent) {
		if (!view.length || innerW <= 0) return;
		const svg = event.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const px = event.clientX - rect.left - m.left;
		const idx = Math.max(0, Math.min(view.length - 1, Math.round(xScale.invert(px))));
		const candle = view[idx];
		if (candle) hover = { x: xScale(idx), candle };
	}
	function onleave() {
		hover = null;
	}
</script>

<div class="chart" use:track>
	{#if view.length === 0}
		<EmptyState
			title="No price data"
			description="No candles are available for this ticker."
			compact
		/>
	{:else}
		<svg
			{width}
			{height}
			viewBox="0 0 {width} {height}"
			role="img"
			aria-label="Candlestick price chart with trade markers"
			onmousemove={onmove}
			onmouseleave={onleave}
		>
			<title
				>Price candles from {formatDateTime(view[0].t)} to {formatDateTime(view[view.length - 1].t)} with
				{markers.length} trade markers.</title
			>
			<g transform="translate({m.left},{m.top})">
				{#each yTicks as tick (tick)}
					<g transform="translate(0,{yScale(tick)})">
						<line x1="0" x2={innerW} class="grid" />
						<text x="-8" dy="0.32em" class="axis-label y">{formatCurrency(tick)}</text>
					</g>
				{/each}
				{#each xTickIdx as idx (idx)}
					<text x={xScale(idx)} y={innerH + 18} class="axis-label x">
						{view[idx].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
					</text>
				{/each}

				{#each view as c, i (c.t + i)}
					{@const up = c.c >= c.o}
					{@const cx = xScale(i)}
					{@const yo = yScale(c.o)}
					{@const yc = yScale(c.c)}
					{@const bodyTop = Math.min(yo, yc)}
					{@const bodyH = Math.max(1, Math.abs(yc - yo))}
					<line
						x1={cx}
						x2={cx}
						y1={yScale(c.h)}
						y2={yScale(c.l)}
						class="wick"
						style:stroke={up ? chartColors.long : chartColors.short}
					/>
					<rect
						x={cx - candleW / 2}
						y={bodyTop}
						width={candleW}
						height={bodyH}
						class="body"
						style:fill={up ? chartColors.long : chartColors.short}
					/>
				{/each}

				{#each placedMarkers as mk (mk.tradeId + mk.kind)}
					{@const color = mk.side === 'long' ? chartColors.long : chartColors.short}
					{#if mk.kind === 'entry'}
						<path
							d="M{mk.x},{mk.y - 7} L{mk.x - 6},{mk.y + 4} L{mk.x + 6},{mk.y + 4} Z"
							style:fill={color}
							class="marker"
						>
							<title>{mk.side} entry @ {formatCurrency(mk.price)} ({formatDateTime(mk.t)})</title>
						</path>
					{:else}
						<path
							d="M{mk.x},{mk.y + 7} L{mk.x - 6},{mk.y - 4} L{mk.x + 6},{mk.y - 4} Z"
							style:fill={color}
							class="marker exit"
						>
							<title>{mk.side} exit @ {formatCurrency(mk.price)} ({formatDateTime(mk.t)})</title>
						</path>
					{/if}
				{/each}

				{#if hover}
					<line x1={hover.x} x2={hover.x} y1="0" y2={innerH} class="cursor" />
				{/if}
			</g>
		</svg>

		{#if hover}
			<div
				class="tooltip"
				style:left="{Math.min(hover.x + m.left, width - 8)}px"
				style:top="{m.top + 4}px"
				role="status"
			>
				<span class="t-date">{formatDateTime(hover.candle.t)}</span>
				<dl>
					<div>
						<dt>O</dt>
						<dd>{formatCurrency(hover.candle.o)}</dd>
					</div>
					<div>
						<dt>H</dt>
						<dd>{formatCurrency(hover.candle.h)}</dd>
					</div>
					<div>
						<dt>L</dt>
						<dd>{formatCurrency(hover.candle.l)}</dd>
					</div>
					<div>
						<dt>C</dt>
						<dd>{formatCurrency(hover.candle.c)}</dd>
					</div>
					<div>
						<dt>V</dt>
						<dd>{formatInt(hover.candle.v)}</dd>
					</div>
				</dl>
			</div>
		{/if}

		{#if downsampled}
			<p class="note">
				Showing {formatInt(view.length)} of {formatInt(parsed.length)} candles (downsampled).
			</p>
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
	.wick {
		stroke-width: 1;
	}
	.body {
		shape-rendering: crispEdges;
	}
	.marker {
		stroke: var(--c-surface);
		stroke-width: 1;
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
	.tooltip {
		position: absolute;
		transform: translateX(-50%);
		pointer-events: none;
		padding: var(--sp-2);
		background: var(--c-surface);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow);
		z-index: var(--z-dropdown);
		min-width: 8rem;
	}
	.t-date {
		display: block;
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
		margin-bottom: var(--sp-1);
	}
	dl {
		display: grid;
		gap: 1px 0;
	}
	dl div {
		display: flex;
		justify-content: space-between;
		gap: var(--sp-3);
	}
	dt {
		color: var(--c-text-muted);
		font-size: var(--fs-xs);
		font-weight: 600;
	}
	dd {
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.note {
		margin-top: var(--sp-1);
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
		text-align: right;
	}
</style>
