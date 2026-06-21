<script lang="ts">
	import { ChartLine } from 'phosphor-svelte';
	import type { BacktestResult, Candle, TradeMarker } from '$lib/types';
	import CandlestickChart from '$lib/charts/CandlestickChart.svelte';
	import { Select, EmptyState, Badge } from '$lib/components/ui';

	interface Props {
		result: BacktestResult;
	}
	let { result }: Props = $props();

	const candleMap = $derived<Record<string, Candle[]>>(result.candles ?? {});
	const tickers = $derived(Object.keys(candleMap).sort());

	// `selected` holds the user's explicit choice; `activeTicker` resolves it to a
	// valid ticker, falling back to the first available one. Deriving (rather than
	// writing in an effect) keeps the default reactive without a write-back loop.
	let selected = $state('');
	const activeTicker = $derived(
		selected && tickers.includes(selected) ? selected : (tickers[0] ?? '')
	);

	const candles = $derived(activeTicker ? (candleMap[activeTicker] ?? []) : []);

	// Derive entry/exit markers for the active ticker from its trades.
	const markers = $derived<TradeMarker[]>(
		result.trades
			.filter((t) => t.ticker === activeTicker)
			.flatMap((t) => [
				{
					tradeId: t.id,
					t: t.entryTime,
					price: t.entryPrice,
					kind: 'entry' as const,
					side: t.side
				},
				{
					tradeId: t.id,
					t: t.exitTime,
					price: t.exitPrice,
					kind: 'exit' as const,
					side: t.side
				}
			])
	);

	const tradeCount = $derived(result.trades.filter((t) => t.ticker === activeTicker).length);
</script>

{#if tickers.length === 0}
	<EmptyState
		title="No price data"
		description="This run was computed without OHLC candles, so the price chart is unavailable."
	>
		{#snippet icon()}<ChartLine size={28} />{/snippet}
	</EmptyState>
{:else}
	<div class="panel-body">
		<div class="controls">
			<div class="ticker-select">
				<Select
					label="Ticker"
					options={tickers.map((t) => ({ value: t, label: t }))}
					bind:value={selected}
				/>
			</div>
			<div class="legend" aria-hidden="true">
				<Badge tone="long" size="sm">▲ Entry / ▼ Exit</Badge>
				<span class="legend-note"
					>{tradeCount} trade{tradeCount === 1 ? '' : 's'} on {activeTicker}</span
				>
			</div>
		</div>

		{#key activeTicker}
			<CandlestickChart {candles} {markers} />
		{/key}
	</div>
{/if}

<style>
	.panel-body {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.controls {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	.ticker-select {
		min-width: 10rem;
	}
	.legend {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}
	.legend-note {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
