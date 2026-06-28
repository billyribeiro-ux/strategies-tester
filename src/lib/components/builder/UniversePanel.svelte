<script lang="ts">
	import type { SessionSpec } from '$lib/types';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import {
		Button,
		Field,
		IconButton,
		NumberInput,
		SegmentedControl,
		Select,
		TextInput
	} from '$lib/components/ui';
	import { Globe, Plus, X } from 'phosphor-svelte';

	interface Props {
		store: StrategyStore;
	}

	let { store }: Props = $props();

	let tickerDraft = $state('');

	// --- universe source (explicit tickers vs point-in-time index) ----------

	const DEFAULT_INDEX = 'sp500';
	const DEFAULT_MAX_SYMBOLS = 25;

	const sourceKind = $derived(store.spec.universe.source?.kind ?? 'tickers');
	const indexSource = $derived(
		store.spec.universe.source?.kind === 'index' ? store.spec.universe.source : null
	);

	const sourceOptions = [
		{ value: 'tickers', label: 'Tickers' },
		{ value: 'index', label: 'Index' }
	];

	function setSourceKind(kind: string) {
		if (kind === sourceKind) return;
		if (kind === 'index') {
			store.setUniverseSource({ kind: 'index', provider: 'fmpPit', index: DEFAULT_INDEX });
		} else {
			store.setUniverseSource({ kind: 'tickers' });
		}
	}

	function setIndex(index: string) {
		const cur = indexSource;
		if (!cur) return;
		store.setUniverseSource({ ...cur, index });
	}

	function setMaxSymbols(max: number | undefined) {
		const cur = indexSource;
		if (!cur) return;
		const maxSymbols =
			typeof max === 'number' && Number.isFinite(max) && max > 0 ? Math.floor(max) : undefined;
		store.setUniverseSource({ ...cur, maxSymbols });
	}

	function commitTicker() {
		const parts = tickerDraft
			.split(/[\s,]+/)
			.map((t) => t.trim())
			.filter(Boolean);
		for (const p of parts) store.addTicker(p);
		tickerDraft = '';
	}

	function onTickerKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			commitTicker();
		}
	}

	const timeframeOptions = $derived(
		store.capabilities.timeframes.map((t) => ({ value: t.id, label: t.label }))
	);

	// Narrowed custom-session view (null unless the session is custom) so the
	// template can safely read startHM/endHM/tz.
	const customSession = $derived(
		store.spec.universe.session.kind === 'custom' ? store.spec.universe.session : null
	);

	// --- date range presets -------------------------------------------------

	const iso = (d: Date) => d.toISOString().slice(0, 10);

	interface Preset {
		id: string;
		label: string;
	}
	const presets: Preset[] = [
		{ id: 'ytd', label: 'YTD' },
		{ id: '1y', label: '1Y' },
		{ id: '3y', label: '3Y' },
		{ id: '5y', label: '5Y' },
		{ id: '10y', label: '10Y' },
		{ id: 'max', label: 'Max' }
	];

	function applyPreset(id: string) {
		const to = new Date();
		// Local, non-reactive date math for presets — SvelteDate is unnecessary.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const from = new Date(to);
		switch (id) {
			case 'ytd':
				from.setMonth(0, 1);
				break;
			case '1y':
				from.setFullYear(from.getFullYear() - 1);
				break;
			case '3y':
				from.setFullYear(from.getFullYear() - 3);
				break;
			case '5y':
				from.setFullYear(from.getFullYear() - 5);
				break;
			case '10y':
				from.setFullYear(from.getFullYear() - 10);
				break;
			case 'max':
				from.setFullYear(2000, 0, 1);
				break;
		}
		store.setDateRange(iso(from), iso(to));
	}

	// --- session ------------------------------------------------------------

	const sessionKind = $derived(store.spec.universe.session.kind);

	function setSessionKind(kind: SessionSpec['kind']) {
		if (kind === sessionKind) return;
		if (kind === 'RTH') store.setSession({ kind: 'RTH' });
		else if (kind === 'ETH') store.setSession({ kind: 'ETH' });
		else
			store.setSession({
				kind: 'custom',
				startHM: '09:30',
				endHM: '16:00',
				tz: 'America/New_York'
			});
	}

	const sessionOptions = [
		{ value: 'RTH', label: 'Regular' },
		{ value: 'ETH', label: 'Extended' },
		{ value: 'custom', label: 'Custom' }
	];

	function updateCustomSession(
		patch: Partial<Omit<Extract<SessionSpec, { kind: 'custom' }>, 'kind'>>
	) {
		const s = store.spec.universe.session;
		if (s.kind !== 'custom') return;
		store.setSession({ ...s, ...patch });
	}

	const tickersError = $derived(
		store.spec.universe.tickers.length === 0 ? 'Add at least one ticker.' : undefined
	);
	const dateError = $derived(store.issues.find((i) => i.path === 'universe.dateRange')?.message);
</script>

<div class="panel-card">
	<header class="head">
		<span class="head-icon"><Globe size={18} /></span>
		<h2>Universe</h2>
	</header>

	<div class="body">
		<!-- Universe source -->
		<div class="source-block">
			<span class="seg-label">Universe source</span>
			<SegmentedControl
				label="Universe source"
				options={sourceOptions}
				bind:value={() => sourceKind, setSourceKind}
			/>
		</div>

		{#if sourceKind === 'tickers'}
			<!-- Tickers -->
			<Field
				label="Tickers"
				hint="Type a symbol and press Enter. Add as many as you like."
				error={tickersError}
			>
				{#snippet children({ id, describedBy, invalid })}
					<div class="ticker-add">
						<input
							{id}
							class="ticker-input"
							placeholder="AAPL"
							autocapitalize="characters"
							aria-describedby={describedBy}
							aria-invalid={invalid || undefined}
							bind:value={tickerDraft}
							onkeydown={onTickerKeydown}
						/>
						<Button
							size="sm"
							variant="secondary"
							onclick={commitTicker}
							disabled={!tickerDraft.trim()}
						>
							{#snippet icon()}<Plus size={14} weight="bold" />{/snippet}
							Add
						</Button>
					</div>
				{/snippet}
			</Field>

			{#if store.spec.universe.tickers.length > 0}
				<ul class="chips">
					{#each store.spec.universe.tickers as ticker (ticker)}
						<li class="chip">
							<span>{ticker}</span>
							<IconButton
								label="Remove {ticker}"
								size="sm"
								onclick={() => store.removeTicker(ticker)}
							>
								<X size={12} weight="bold" />
							</IconButton>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if indexSource}
			<!-- Point-in-time index membership -->
			<div class="grid-2">
				<Field label="Provider" hint="Survivorship-free, resolved at the run's start date.">
					{#snippet children({ id })}
						<input
							{id}
							class="ticker-input provider-fixed"
							value="FMP point-in-time"
							readonly
							aria-readonly="true"
						/>
					{/snippet}
				</Field>
				<TextInput
					label="Index"
					placeholder="sp500"
					hint="Index slug (e.g. sp500)."
					value={indexSource.index}
					oninput={(e) => setIndex(e.currentTarget.value)}
				/>
			</div>
			<NumberInput
				label="Max symbols (optional)"
				hint="Cap the resolved members for this run. Default {DEFAULT_MAX_SYMBOLS}, hard cap 50."
				min={1}
				step={1}
				placeholder={String(DEFAULT_MAX_SYMBOLS)}
				suffix="symbols"
				bind:value={() => indexSource.maxSymbols ?? DEFAULT_MAX_SYMBOLS, setMaxSymbols}
			/>
		{/if}

		<!-- Timeframe -->
		<div class="grid-2">
			<Select
				label="Timeframe"
				options={timeframeOptions}
				bind:value={() => store.spec.universe.timeframe, (v) => store.setTimeframe(v)}
			/>
			<div class="session-block">
				<span class="seg-label">Session</span>
				<div class="seg-row" role="radiogroup" aria-label="Trading session">
					{#each sessionOptions as opt (opt.value)}
						<button
							type="button"
							class="seg-opt"
							class:active={sessionKind === opt.value}
							role="radio"
							aria-checked={sessionKind === opt.value}
							onclick={() => setSessionKind(opt.value as SessionSpec['kind'])}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		{#if customSession}
			<div class="grid-3">
				<Field label="Session start">
					{#snippet children({ id })}
						<input
							{id}
							type="time"
							class="time-input"
							value={customSession.startHM}
							onchange={(e) => updateCustomSession({ startHM: e.currentTarget.value })}
						/>
					{/snippet}
				</Field>
				<Field label="Session end">
					{#snippet children({ id })}
						<input
							{id}
							type="time"
							class="time-input"
							value={customSession.endHM}
							onchange={(e) => updateCustomSession({ endHM: e.currentTarget.value })}
						/>
					{/snippet}
				</Field>
				<TextInput
					label="Time zone"
					placeholder="America/New_York"
					value={customSession.tz}
					oninput={(e) => updateCustomSession({ tz: e.currentTarget.value })}
				/>
			</div>
		{/if}

		<!-- Date range -->
		<Field label="Backtest period" error={dateError}>
			{#snippet children({ id })}
				<div class="dates">
					<div class="date-inputs">
						<input
							{id}
							type="date"
							class="date-input"
							aria-label="From date"
							value={store.spec.universe.dateRange.from}
							max={store.spec.universe.dateRange.to}
							onchange={(e) =>
								store.setDateRange(e.currentTarget.value, store.spec.universe.dateRange.to)}
						/>
						<span class="date-sep" aria-hidden="true">→</span>
						<input
							type="date"
							class="date-input"
							aria-label="To date"
							value={store.spec.universe.dateRange.to}
							min={store.spec.universe.dateRange.from}
							onchange={(e) =>
								store.setDateRange(store.spec.universe.dateRange.from, e.currentTarget.value)}
						/>
					</div>
					<div class="presets" role="group" aria-label="Date range presets">
						{#each presets as preset (preset.id)}
							<button type="button" class="preset" onclick={() => applyPreset(preset.id)}>
								{preset.label}
							</button>
						{/each}
					</div>
				</div>
			{/snippet}
		</Field>

		<!-- Benchmark -->
		<TextInput
			label="Benchmark (optional)"
			placeholder="e.g. SPY"
			hint="Overlay a buy-and-hold benchmark on the equity curve."
			value={store.spec.universe.benchmark ?? ''}
			oninput={(e) => store.setBenchmark(e.currentTarget.value)}
		/>
	</div>
</div>

<style>
	.panel-card {
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
		overflow: clip;
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		padding: var(--sp-4) var(--sp-5);
		border-bottom: 1px solid var(--c-border);
	}
	.head-icon {
		display: inline-flex;
		color: var(--c-text-muted);
	}
	h2 {
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		padding: var(--sp-5);
	}
	.ticker-add {
		display: flex;
		gap: var(--sp-2);
		align-items: stretch;
	}
	.ticker-input {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.4375rem 0.625rem;
		background: var(--c-bg);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		color: var(--c-text);
		text-transform: uppercase;
	}
	.ticker-input:focus-visible {
		border-color: var(--c-primary);
	}
	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.25rem 0.125rem 0.5rem;
		background: var(--c-surface-3);
		border-radius: var(--radius-full);
		font-size: var(--fs-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-3);
	}
	.grid-3 {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-3);
	}
	.session-block,
	.source-block {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
	}
	.provider-fixed {
		text-transform: none;
		color: var(--c-text-muted);
		cursor: default;
	}
	.seg-label {
		font-size: var(--fs-sm);
		font-weight: 550;
		color: var(--c-text-muted);
	}
	.seg-row {
		display: inline-flex;
		padding: 2px;
		gap: 2px;
		background: var(--c-surface-2);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		width: fit-content;
	}
	.seg-opt {
		padding: 0.3125rem 0.75rem;
		font-size: var(--fs-sm);
		border: none;
		background: transparent;
		color: var(--c-text-muted);
		border-radius: calc(var(--radius) - 2px);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.seg-opt:hover {
		color: var(--c-text);
	}
	.seg-opt.active {
		background: var(--c-surface);
		color: var(--c-text);
		box-shadow: var(--shadow-sm);
	}
	.time-input,
	.date-input {
		width: 100%;
		padding: 0.4375rem 0.625rem;
		background: var(--c-bg);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		color: var(--c-text);
		font-variant-numeric: tabular-nums;
	}
	.time-input:focus-visible,
	.date-input:focus-visible {
		border-color: var(--c-primary);
	}
	.dates {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.date-inputs {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}
	.date-sep {
		color: var(--c-text-faint);
		flex: none;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-1);
	}
	.preset {
		padding: 0.25rem 0.625rem;
		font-size: var(--fs-xs);
		font-weight: 600;
		background: var(--c-surface-2);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		color: var(--c-text-muted);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.preset:hover {
		background: var(--c-surface-3);
		color: var(--c-text);
	}

	@media (min-width: 40rem) {
		.grid-2 {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
		.grid-3 {
			grid-template-columns: 1fr 1fr 1fr;
		}
	}
</style>
