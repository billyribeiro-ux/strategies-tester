<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import type { ForwardState } from '$lib/server/paper';
	import {
		Badge,
		Button,
		Callout,
		Card,
		EmptyState,
		ErrorState,
		LoadingState,
		Select
	} from '$lib/components/ui';
	import { Broadcast, Play, WarningCircle, Info } from 'phosphor-svelte';

	let { data }: { data: PageData } = $props();

	let selectedId = $state(untrack(() => data.selected?.id ?? data.strategies[0]?.id ?? ''));
	const selected = $derived(data.strategies.find((s) => s.id === selectedId) ?? null);

	const strategyOptions = $derived(
		data.strategies.map((s) => ({ value: s.id, label: `${s.name} (v${s.version})` }))
	);

	let running = $state(false);
	// The result/error are tagged with the strategy id they belong to, so a
	// selection change makes them stale without writing state from an $effect.
	let runError = $state<{ id: string; message: string } | null>(null);
	let result = $state<{ id: string; value: ForwardState } | null>(null);

	// Only surface a result/error that belongs to the current selection.
	const forward = $derived(result && result.id === selectedId ? result.value : null);
	const errorMessage = $derived(runError && runError.id === selectedId ? runError.message : null);

	/**
	 * Direct fetch to /api/paper. We read the body as text and parse JSON so this
	 * works the same in SSR and the browser (SvelteKit restricts which fetch
	 * headers a load may read), mirroring the typed client's request helper.
	 */
	async function check() {
		const target = selected;
		if (!target) return;
		const id = target.id;
		runError = null;
		result = null;
		running = true;
		try {
			const res = await fetch('/api/paper', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ spec: target.spec })
			});
			const text = await res.text().catch(() => '');
			let payload: unknown = text.length ? text : undefined;
			if (text.length) {
				try {
					payload = JSON.parse(text);
				} catch {
					payload = text;
				}
			}
			if (!res.ok) {
				const message =
					payload && typeof payload === 'object' && 'message' in payload
						? String((payload as { message: unknown }).message)
						: `Request failed (${res.status})`;
				throw new Error(message);
			}
			result = { id, value: payload as ForwardState };
		} catch (e) {
			runError = { id, message: e instanceof Error ? e.message : 'Signal check failed.' };
		} finally {
			running = false;
		}
	}

	function formatAsOf(iso: string | null): string {
		if (!iso) return '—';
		const ms = Date.parse(iso);
		return Number.isFinite(ms) ? new Date(ms).toUTCString() : iso;
	}

	function formatPrice(value: number | null): string {
		return value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
	}
</script>

<svelte:head><title>Paper · Strategy Tester</title></svelte:head>

<header class="page-head">
	<span class="head-icon"><Broadcast size={26} weight="duotone" /></span>
	<div class="titles">
		<h1>Paper / forward signals</h1>
		<p>
			Run the <strong>identical engine</strong> on the latest data — no logic fork between backtest and
			live. See what the strategy signals right now, at the last closed bar.
		</p>
	</div>
</header>

{#if data.error}
	<ErrorState title="Couldn't load" message={data.error} />
{:else if data.strategies.length === 0}
	<EmptyState
		title="No saved strategies"
		description="Build and save a strategy first, then check its current signals here."
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

				<Callout tone="info" title="Same engine as the backtest">
					{#snippet icon()}<Info size={16} weight="fill" />{/snippet}
					This checks the strategy against the latest candles using the exact backtest engine, then reports
					the live signal at the last closed bar and any positions that would still be open.
				</Callout>

				<div class="run-row">
					<Button variant="primary" onclick={check} loading={running} disabled={!selected}>
						{#snippet icon()}<Play size={16} weight="fill" />{/snippet}
						Check current signals
					</Button>
				</div>

				{#if errorMessage}
					<Callout tone="danger" title="Signal check failed">
						{#snippet icon()}<WarningCircle size={16} weight="fill" />{/snippet}
						{errorMessage}
						{#if /api key/i.test(errorMessage)}
							— <a href="/settings">Add your FMP key in Settings</a>.
						{/if}
					</Callout>
				{/if}
			</div>
		</Card>

		{#if running}
			<LoadingState label="Checking current signals…" />
		{:else if forward}
			{@const s = forward}
			<Card>
				<div class="results">
					<div class="asof">
						<span class="k">As of last closed bar</span>
						<span class="v">{formatAsOf(s.asOf)}</span>
					</div>

					{#if s.warnings.length}
						<Callout tone="warning" title="Note">{s.warnings.join(' ')}</Callout>
					{/if}

					{#if s.perTicker.length === 0}
						<EmptyState title="No tickers" description="This strategy's universe has no tickers." />
					{:else}
						<div class="tickers">
							{#each s.perTicker as t (t.ticker)}
								<div class="ticker">
									<div class="ticker-head">
										<span class="symbol">{t.ticker}</span>
										<span class="last">
											{#if t.lastBarTime}
												last close {formatPrice(t.lastClose)}
											{:else}
												no data
											{/if}
										</span>
									</div>

									<div class="badges">
										{#if t.signals.longEntry}
											<Badge tone="long">Long entry signal active</Badge>
										{/if}
										{#if t.signals.longExit}
											<Badge tone="warning">Long exit signal active</Badge>
										{/if}
										{#if t.signals.shortEntry}
											<Badge tone="short">Short entry signal active</Badge>
										{/if}
										{#if t.signals.shortExit}
											<Badge tone="warning">Short exit signal active</Badge>
										{/if}
										{#if !t.signals.longEntry && !t.signals.longExit && !t.signals.shortEntry && !t.signals.shortExit}
											<Badge tone="neutral">No signal</Badge>
										{/if}
									</div>

									{#if t.openPositions.length}
										<div class="positions">
											<span class="positions-label">Still open</span>
											{#each t.openPositions as p, i (t.ticker + '_' + i)}
												<div class="position">
													<Badge tone={p.side === 'long' ? 'long' : 'short'}>{p.side}</Badge>
													<span class="pos-detail">
														{p.qty} @ {formatPrice(p.entryPrice)}
														<span class="pos-since">since {formatAsOf(p.entryTime)}</span>
													</span>
												</div>
											{/each}
										</div>
									{:else}
										<p class="flat">No open position.</p>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					<p class="summary">
						Signals are evaluated point-in-time at the last closed bar — the strategy would act on
						them at the next bar's open, exactly as the engine fills during a backtest.
					</p>
				</div>
			</Card>
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
		max-width: 48rem;
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
	.run-row {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}
	.results {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.asof {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.asof .k {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
	}
	.asof .v {
		font-size: var(--fs-lg);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.tickers {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.ticker {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		padding: var(--sp-3);
	}
	.ticker-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--sp-3);
	}
	.symbol {
		font-size: var(--fs-md);
		font-weight: 700;
	}
	.last {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
	}
	.positions {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		margin-top: var(--sp-1);
	}
	.positions-label {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.position {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		font-size: var(--fs-sm);
	}
	.pos-detail {
		font-variant-numeric: tabular-nums;
	}
	.pos-since {
		color: var(--c-text-faint);
	}
	.flat {
		font-size: var(--fs-sm);
		color: var(--c-text-faint);
	}
	.summary {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
</style>
