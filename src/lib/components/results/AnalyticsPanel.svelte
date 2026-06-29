<script lang="ts">
	import { EXIT_REASON_LABELS, type ExitReason } from '$lib/types';
	import {
		formatRatio,
		formatPercent,
		formatSignedPercent,
		formatSignedCurrency,
		formatInt,
		formatDuration
	} from '$lib/utils/format';
	import { Callout, Spinner, Badge, SegmentedControl } from '$lib/components/ui';

	// Local view types mirror the JSON shape returned by /api/analytics. They are a
	// structural copy of the engine's `Analytics` interfaces — a client component
	// must never import server-only engine code.
	interface AttributionRowView {
		count: number;
		netPnl: number;
		wins: number;
		winRate: number;
	}
	interface AttributionView {
		bySymbol: Record<string, AttributionRowView>;
		bySide: Record<string, AttributionRowView>;
		byExitReason: Record<string, AttributionRowView>;
	}
	interface YearRegimeView {
		year: number;
		returnPct: number;
	}
	interface AnalyticsView {
		cvar: number;
		ulcerIndex: number;
		timeUnderwater: { longestBars: number; fraction: number };
		longestLosingStreak: number;
		calmar: number;
		omega: number;
		alphaBeta: { alpha: number; beta: number };
		attribution: AttributionView;
		regimeByYear: YearRegimeView[];
	}

	interface Props {
		analytics: AnalyticsView | null;
		loading?: boolean;
		error?: string | null;
	}
	let { analytics, loading = false, error = null }: Props = $props();

	/** Risk cards — value is precomputed text so NaN/Infinity collapse to "—". */
	const riskCards = $derived(
		analytics
			? [
					{
						label: 'CVaR (5%)',
						value: formatSignedPercent(analytics.cvar),
						hint: 'Mean of the worst 5% of trade returns'
					},
					{
						label: 'Ulcer index',
						value: formatRatio(analytics.ulcerIndex),
						hint: 'RMS of drawdown depth'
					},
					{
						label: 'Calmar',
						value: formatRatio(analytics.calmar),
						hint: 'CAGR ÷ |max drawdown|'
					},
					{
						label: 'Omega',
						value: formatRatio(analytics.omega),
						hint: 'Gains ÷ losses about zero'
					},
					{
						label: 'Time underwater',
						value: formatPercent(analytics.timeUnderwater.fraction),
						hint: `Longest run ${formatDuration(analytics.timeUnderwater.longestBars)}`
					},
					{
						label: 'Longest losing streak',
						value: formatInt(analytics.longestLosingStreak),
						hint: 'Most consecutive losing trades'
					}
				]
			: []
	);

	type AttrDim = 'bySymbol' | 'bySide' | 'byExitReason';
	const DIM_OPTIONS: { value: AttrDim; label: string }[] = [
		{ value: 'bySymbol', label: 'By symbol' },
		{ value: 'bySide', label: 'By side' },
		{ value: 'byExitReason', label: 'By exit reason' }
	];
	let activeDim = $state<AttrDim>('bySymbol');

	const SIDE_LABELS: Record<string, string> = { long: 'Long', short: 'Short' };

	/** Human label for an attribution row key, by dimension. */
	function rowLabel(dim: AttrDim, key: string): string {
		if (dim === 'bySide') return SIDE_LABELS[key] ?? key;
		if (dim === 'byExitReason') return EXIT_REASON_LABELS[key as ExitReason] ?? key;
		return key;
	}

	/** Attribution rows for the active dimension, descending by net P&L. */
	const attributionRows = $derived(
		analytics
			? Object.entries(analytics.attribution[activeDim])
					.map(([key, row]) => ({ key, label: rowLabel(activeDim, key), ...row }))
					.sort((a, b) => b.netPnl - a.netPnl)
			: []
	);

	const regimeRows = $derived(analytics ? analytics.regimeByYear : []);
</script>

<section class="analytics" aria-label="Performance analytics" aria-busy={loading}>
	{#if loading}
		<div class="state" role="status">
			<Spinner size={24} label="Computing analytics…" />
			<p>Computing analytics…</p>
		</div>
	{:else if error}
		<Callout tone="danger" title="Analytics failed">
			{error}
		</Callout>
	{:else if !analytics}
		<Callout tone="info" title="No analytics yet">
			Load analytics to see tail-risk, drawdown-shape and attribution measures here.
		</Callout>
	{:else}
		<!-- Risk & ratio cards -->
		<section class="section" aria-label="Risk and ratios">
			<h3 class="section-title">Risk &amp; ratios</h3>
			<div class="grid">
				{#each riskCards as card (card.label)}
					<div class="card" title={card.hint}>
						<span class="card-label">{card.label}</span>
						<span class="card-value">{card.value}</span>
						<span class="card-hint">{card.hint}</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- Attribution -->
		<section class="section" aria-label="Trade attribution">
			<div class="section-head">
				<h3 class="section-title">Attribution</h3>
				<SegmentedControl
					bind:value={activeDim}
					options={DIM_OPTIONS}
					size="sm"
					label="Attribution dimension"
				/>
			</div>
			{#if attributionRows.length === 0}
				<p class="empty">No trades to attribute.</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th scope="col" class="left"
									>{DIM_OPTIONS.find((o) => o.value === activeDim)?.label}</th
								>
								<th scope="col">Trades</th>
								<th scope="col">Net P&amp;L</th>
								<th scope="col">Win rate</th>
							</tr>
						</thead>
						<tbody>
							{#each attributionRows as row (row.key)}
								<tr>
									<th scope="row" class="left">{row.label}</th>
									<td>{formatInt(row.count)}</td>
									<td class:pos={row.netPnl > 0} class:neg={row.netPnl < 0}>
										{formatSignedCurrency(row.netPnl)}
									</td>
									<td>{formatPercent(row.winRate)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<!-- Per-year regime -->
		<section class="section" aria-label="Per-year regime">
			<h3 class="section-title">Regime by year</h3>
			{#if regimeRows.length === 0}
				<p class="empty">No yearly returns available.</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th scope="col" class="left">Year</th>
								<th scope="col">Return</th>
								<th scope="col" class="bar-col"><span class="sr-only">Magnitude</span></th>
							</tr>
						</thead>
						<tbody>
							{#each regimeRows as row (row.year)}
								<tr>
									<th scope="row" class="left">{row.year}</th>
									<td class:pos={row.returnPct > 0} class:neg={row.returnPct < 0}>
										{formatSignedPercent(row.returnPct)}
									</td>
									<td class="bar-col">
										<Badge
											tone={row.returnPct > 0 ? 'long' : row.returnPct < 0 ? 'short' : 'neutral'}
											size="sm"
										>
											{row.returnPct > 0 ? 'Up' : row.returnPct < 0 ? 'Down' : 'Flat'}
										</Badge>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}
</section>

<style>
	.analytics {
		display: flex;
		flex-direction: column;
		gap: var(--sp-6);
	}

	/* ---- state (loading) ---- */
	.state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-3);
		padding: var(--sp-12) var(--sp-6);
		color: var(--c-text-muted);
		font-size: var(--fs-sm);
	}

	/* ---- sections ---- */
	.section {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}
	.section-title {
		font-size: var(--fs-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--c-text-muted);
	}
	.empty {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}

	/* ---- risk cards ---- */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: var(--sp-3);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		padding: var(--sp-3) var(--sp-4);
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-sm);
	}
	.card-label {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
		font-weight: 550;
	}
	.card-value {
		font-size: var(--fs-xl);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		line-height: var(--lh-tight);
		color: var(--c-text);
	}
	.card-hint {
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
	}

	/* ---- tables ---- */
	.table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-sm);
	}
	th,
	td {
		padding: var(--sp-2) var(--sp-3);
		text-align: right;
		font-variant-numeric: tabular-nums;
		border-bottom: 1px solid var(--c-border);
		white-space: nowrap;
	}
	.left {
		text-align: left;
	}
	thead th {
		font-size: var(--fs-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--c-text-muted);
	}
	tbody th {
		font-weight: 550;
		color: var(--c-text);
	}
	tbody td {
		color: var(--c-text);
	}
	tbody tr:last-child th,
	tbody tr:last-child td {
		border-bottom: none;
	}
	.pos {
		color: var(--c-long);
	}
	.neg {
		color: var(--c-short);
	}
	.bar-col {
		width: 1%;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
