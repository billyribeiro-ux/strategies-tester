<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { createApiClient, ApiError } from '$lib/api/client';
	import type { OptimizationResult } from '$lib/types';
	import {
		Button,
		Callout,
		Card,
		EmptyState,
		ErrorState,
		LoadingState,
		Select
	} from '$lib/components/ui';
	import { Sliders, Play, WarningCircle } from 'phosphor-svelte';
	import { formatPercent, formatSignedPercent, formatRatio } from '$lib/utils/format';

	let { data }: { data: PageData } = $props();
	const api = createApiClient();

	let selectedId = $state(untrack(() => data.selected?.id ?? data.strategies[0]?.id ?? ''));
	const selected = $derived(data.strategies.find((s) => s.id === selectedId) ?? null);

	const strategyOptions = $derived(
		data.strategies.map((s) => ({ value: s.id, label: `${s.name} (v${s.version})` }))
	);

	// Numeric indicator params available to sweep on the selected strategy.
	interface ParamRow {
		indicatorId: string;
		indicatorLabel: string;
		param: string;
		def: number;
	}
	const paramRows = $derived.by<ParamRow[]>(() => {
		if (!selected || !data.capabilities) return [];
		const rows: ParamRow[] = [];
		for (const inst of selected.spec.indicators) {
			const cap = data.capabilities.indicators.find((c) => c.type === inst.type);
			if (!cap) continue;
			for (const p of cap.params) {
				if (p.kind === 'int' || p.kind === 'float') {
					const cur = inst.params[p.name];
					rows.push({
						indicatorId: inst.id,
						indicatorLabel: inst.label ?? cap.label,
						param: p.name,
						def: typeof cur === 'number' ? cur : p.default
					});
				}
			}
		}
		return rows;
	});

	const keyOf = (r: ParamRow) => `${r.indicatorId}|${r.param}`;

	// User edits only; effective value falls back to defaults so SSR is safe and
	// switching strategies never reads a missing key.
	let edits = $state<Record<string, { enabled: boolean; values: string }>>({});
	function effective(r: ParamRow) {
		return edits[keyOf(r)] ?? { enabled: false, values: String(r.def) };
	}
	function setEdit(r: ParamRow, patch: Partial<{ enabled: boolean; values: string }>) {
		edits[keyOf(r)] = { ...effective(r), ...patch };
	}

	const sortOptions = [
		{ value: 'totalReturn', label: 'Total return' },
		{ value: 'sharpe', label: 'Sharpe ratio' },
		{ value: 'sortino', label: 'Sortino ratio' },
		{ value: 'maxDrawdown', label: 'Max drawdown' },
		{ value: 'profitFactor', label: 'Profit factor' },
		{ value: 'winRate', label: 'Win rate' }
	];
	let sortMetric = $state('totalReturn');

	let running = $state(false);
	let runError = $state<string | null>(null);
	let result = $state<OptimizationResult | null>(null);

	// Clear stale results when the strategy selection changes.
	$effect(() => {
		void selectedId;
		untrack(() => {
			result = null;
			runError = null;
		});
	});

	const parseValues = (text: string): number[] =>
		text
			.split(/[\s,]+/)
			.map((s) => Number(s))
			.filter((n) => Number.isFinite(n));

	const params = $derived(
		paramRows
			.filter((r) => effective(r).enabled && parseValues(effective(r).values).length > 0)
			.map((r) => ({
				indicatorId: r.indicatorId,
				param: r.param,
				values: parseValues(effective(r).values)
			}))
	);
	const comboCount = $derived(params.reduce((n, p) => n * p.values.length, params.length ? 1 : 0));
	const canRun = $derived(!!selected && params.length > 0);

	// Column labels for the swept params, taken from the result so they stay
	// consistent with the ranked rows even if inputs change afterwards.
	const sweptCols = $derived(
		(result?.combos[0]?.overrides ?? []).map((o) => {
			const inst = selected?.spec.indicators.find((i) => i.id === o.indicatorId);
			const cap = data.capabilities?.indicators.find((c) => c.type === inst?.type);
			return `${inst?.label ?? cap?.label ?? o.indicatorId} · ${o.param}`;
		})
	);

	async function run() {
		if (!selected || !canRun) return;
		runError = null;
		running = true;
		result = null;
		try {
			result = await api.optimize({ base: selected.spec, params, sortMetric });
		} catch (e) {
			runError = e instanceof ApiError ? e.message : 'Optimization failed.';
		} finally {
			running = false;
		}
	}
</script>

<svelte:head><title>Optimize · Strategy Tester</title></svelte:head>

<header class="page-head">
	<span class="head-icon"><Sliders size={26} weight="duotone" /></span>
	<div class="titles">
		<h1>Parameter optimization</h1>
		<p>Sweep indicator parameters across a saved strategy and rank the results.</p>
	</div>
</header>

{#if data.error || !data.capabilities}
	<ErrorState title="Couldn't load" message={data.error ?? 'Capabilities unavailable.'} />
{:else if data.strategies.length === 0}
	<EmptyState
		title="No saved strategies"
		description="Build and save a strategy first, then optimize its parameters."
	>
		{#snippet action()}
			<Button variant="primary" onclick={() => goto('/backtest')}>New strategy</Button>
		{/snippet}
	</EmptyState>
{:else}
	<div class="layout">
		<Card>
			<div class="form">
				<Select label="Strategy" options={strategyOptions} bind:value={selectedId} />

				{#if paramRows.length === 0}
					<Callout tone="info" title="No numeric parameters">
						This strategy declares no indicator parameters to sweep. Add indicators in the builder.
					</Callout>
				{:else}
					<fieldset class="params">
						<legend>Parameters to sweep</legend>
						{#each paramRows as r (keyOf(r))}
							{@const inp = effective(r)}
							<div class="param-row">
								<label class="chk">
									<input
										type="checkbox"
										checked={inp.enabled}
										onchange={(e) => setEdit(r, { enabled: e.currentTarget.checked })}
									/>
									<span>{r.indicatorLabel} · {r.param}</span>
								</label>
								<input
									class="vals"
									type="text"
									inputmode="numeric"
									placeholder="e.g. 5, 10, 20"
									aria-label="{r.indicatorLabel} {r.param} values"
									value={inp.values}
									disabled={!inp.enabled}
									oninput={(e) => setEdit(r, { values: e.currentTarget.value })}
								/>
							</div>
						{/each}
					</fieldset>

					<Select label="Rank by" options={sortOptions} bind:value={sortMetric} />

					<div class="run-row">
						<Button variant="primary" onclick={run} loading={running} disabled={!canRun}>
							{#snippet icon()}<Play size={16} weight="fill" />{/snippet}
							Run {comboCount} backtest{comboCount === 1 ? '' : 's'}
						</Button>
						{#if !canRun}
							<span class="hint">Enable at least one parameter and enter values.</span>
						{/if}
					</div>
				{/if}

				{#if runError}
					<Callout tone="danger" title="Optimization failed">
						{#snippet icon()}<WarningCircle size={16} weight="fill" />{/snippet}
						{runError}
						{#if /api key/i.test(runError)}
							— <a href="/settings">Add your FMP key in Settings</a>.
						{/if}
					</Callout>
				{/if}
			</div>
		</Card>

		{#if running}
			<LoadingState label="Running parameter sweep…" />
		{:else if result}
			{#if result.warnings.length}
				<Callout tone="warning" title="Note">{result.warnings.join(' ')}</Callout>
			{/if}
			{#if result.combos.length === 0}
				<EmptyState title="No results" description="No combinations were produced." />
			{:else}
				<Card>
					<div class="results">
						<p class="summary">
							Ran {result.ran} of {result.totalCombos} combinations · ranked by {result.sortMetric}.
						</p>
						<div class="table-wrap">
							<table>
								<thead>
									<tr>
										<th class="num">#</th>
										{#each sweptCols as col (col)}<th>{col}</th>{/each}
										<th class="num">Return</th>
										<th class="num">Sharpe</th>
										<th class="num">Max DD</th>
										<th class="num">Win %</th>
										<th class="num">Trades</th>
									</tr>
								</thead>
								<tbody>
									{#each result.combos as c, i (c.id)}
										<tr class:best={i === 0}>
											<td class="num">{i + 1}</td>
											{#each c.overrides as o (o.indicatorId + o.param)}<td class="num"
													>{o.value}</td
												>{/each}
											<td class="num">{formatSignedPercent(c.totalReturn)}</td>
											<td class="num">{formatRatio(c.sharpe)}</td>
											<td class="num">{formatPercent(c.maxDrawdown)}</td>
											<td class="num">{formatPercent(c.winRate)}</td>
											<td class="num">{c.totalTrades}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</Card>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.page-head {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin-bottom: var(--sp-6);
	}
	.head-icon {
		display: inline-flex;
		color: var(--c-primary);
	}
	.titles h1 {
		font-size: var(--fs-2xl);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.titles p {
		margin-top: var(--sp-1);
		font-size: var(--fs-base);
		color: var(--c-text-muted);
	}
	.layout {
		display: flex;
		flex-direction: column;
		gap: var(--sp-5);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		max-width: 42rem;
	}
	.params {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		padding: var(--sp-3);
		margin: 0;
	}
	.params legend {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--c-text-muted);
		padding: 0 var(--sp-1);
	}
	.param-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--sp-3);
		align-items: center;
	}
	.chk {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		font-size: var(--fs-sm);
	}
	.vals {
		padding: 0.375rem var(--sp-2);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		background: var(--c-surface);
		color: var(--c-text);
		font-size: var(--fs-sm);
	}
	.vals:disabled {
		opacity: 0.5;
	}
	.run-row {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}
	.hint {
		font-size: var(--fs-sm);
		color: var(--c-text-faint);
	}
	.summary {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		margin-bottom: var(--sp-3);
	}
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
		text-align: left;
		border-bottom: 1px solid var(--c-border);
		white-space: nowrap;
	}
	th.num,
	td.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tbody tr.best {
		background: var(--c-primary-soft);
	}
	tbody tr.best td {
		font-weight: 600;
	}
</style>
