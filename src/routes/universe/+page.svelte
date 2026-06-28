<script lang="ts">
	import type { PageData } from './$types';
	import {
		Button,
		Callout,
		Card,
		EmptyState,
		LoadingState,
		Select,
		TextInput
	} from '$lib/components/ui';
	import { Buildings, ListMagnifyingGlass, WarningCircle, Info, Stack } from 'phosphor-svelte';

	let { data }: { data: PageData } = $props();

	interface UniverseMembership {
		date: string;
		symbols: string[];
	}
	interface CoverageGap {
		detail: string;
	}
	interface ResolveResponse {
		providerId: string;
		membership: UniverseMembership[];
		gaps: CoverageGap[];
	}

	type Provider = 'explicit' | 'fmpPit';

	const providerOptions = [
		{ value: 'explicit', label: 'Explicit list' },
		{ value: 'fmpPit', label: 'FMP point-in-time (S&P 500)' }
	];

	let provider = $state<Provider>('explicit');
	let symbolsText = $state('AAPL, MSFT, GOOGL, AMZN');
	let index = $state('sp500');
	let from = $state(data.defaults.from);
	let to = $state(data.defaults.to);

	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let result = $state<ResolveResponse | null>(null);

	/** Parse the textarea into a clean, de-duplicated symbol list. */
	const parsedSymbols = $derived(
		[
			...new Set(
				symbolsText
					.split(/[\s,;\n]+/)
					.map((s) => s.trim().toUpperCase())
					.filter(Boolean)
			)
		].sort()
	);

	const canResolve = $derived(
		!loading &&
			Boolean(from) &&
			Boolean(to) &&
			from < to &&
			(provider === 'fmpPit' || parsedSymbols.length > 0)
	);

	async function resolve() {
		errorMessage = null;
		result = null;
		loading = true;

		const requestBody =
			provider === 'explicit'
				? { provider, symbols: parsedSymbols, from, to }
				: { provider, index: index.trim() || 'sp500', from, to };

		try {
			const res = await fetch('/api/universe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(requestBody)
			});

			// Read as text then JSON.parse — avoids the SSR content-type pitfall and
			// still lets us surface a server { message } error body.
			const text = await res.text().catch(() => '');
			let payload: unknown = undefined;
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

			result = payload as ResolveResponse;
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Could not resolve the universe.';
		} finally {
			loading = false;
		}
	}

	const totalGaps = $derived(result?.gaps.length ?? 0);
	const totalSnapshots = $derived(result?.membership.length ?? 0);
</script>

<svelte:head><title>Universe · Strategy Tester</title></svelte:head>

<header class="page-head">
	<span class="head-icon"><Buildings size={26} weight="duotone" /></span>
	<div class="titles">
		<h1>Universe Explorer</h1>
		<p>
			Resolve which symbols were members of an index or list as of each date — the data a
			survivorship-bias-free backtest needs.
		</p>
	</div>
</header>

<div class="block">
	<Callout tone="info" title="Survivorship bias, made honest">
		{#snippet icon()}<Info size={16} weight="fill" />{/snippet}
		An <strong>explicit list</strong> is NOT survivorship-free: it is a fixed set of names and
		cannot include companies delisted or removed before the list was authored. The
		<strong>FMP point-in-time</strong> provider reconstructs membership from the historical change log
		and folds in delisted names that were live during the window, so removed/delisted constituents are
		not silently dropped. Any coverage gaps are reported below rather than hidden.
	</Callout>
</div>

<Card>
	<div class="form">
		<Select label="Provider" options={providerOptions} bind:value={provider} />

		{#if provider === 'explicit'}
			<div class="field">
				<label class="lbl" for="symbols">Symbols</label>
				<textarea
					id="symbols"
					class="textarea"
					rows="4"
					placeholder="AAPL, MSFT, GOOGL …"
					bind:value={symbolsText}></textarea>
				<p class="hint">
					Separate with commas, spaces or new lines. Parsed to {parsedSymbols.length}
					unique symbol{parsedSymbols.length === 1 ? '' : 's'}.
				</p>
			</div>
		{:else}
			<TextInput
				label="Index"
				hint="Index slug for the FMP point-in-time feed. Only 'sp500' has a documented historical feed."
				placeholder="sp500"
				bind:value={index}
			/>
		{/if}

		<div class="dates">
			<TextInput label="From" type="date" bind:value={from} />
			<TextInput label="To" type="date" bind:value={to} />
		</div>

		{#if from && to && from >= to}
			<Callout tone="warning" title="Invalid date range">
				{#snippet icon()}<WarningCircle size={16} weight="fill" />{/snippet}
				The "from" date must be earlier than the "to" date.
			</Callout>
		{/if}

		<div class="actions">
			<Button variant="primary" onclick={resolve} {loading} disabled={!canResolve}>
				{#snippet icon()}<ListMagnifyingGlass size={16} weight="bold" />{/snippet}
				Resolve universe
			</Button>
		</div>
	</div>
</Card>

<div class="results">
	{#if loading}
		<Card>
			<LoadingState label="Resolving universe…" />
		</Card>
	{:else if errorMessage}
		<Callout tone="danger" title="Couldn't resolve the universe">
			{#snippet icon()}<WarningCircle size={16} weight="fill" />{/snippet}
			{errorMessage}
		</Callout>
	{:else if result}
		{@const res = result}
		<div class="result-head">
			<h2>Resolved membership</h2>
			<p class="provider-id">
				Provider <code>{res.providerId}</code> · {totalSnapshots} snapshot{totalSnapshots === 1
					? ''
					: 's'}
			</p>
		</div>

		{#if totalGaps > 0}
			<Callout tone="warning" title={`Coverage gaps (${totalGaps})`}>
				{#snippet icon()}<WarningCircle size={16} weight="fill" />{/snippet}
				<ul class="gaps">
					{#each res.gaps as gap, i (i)}
						<li>{gap.detail}</li>
					{/each}
				</ul>
			</Callout>
		{:else}
			<Callout tone="success" title="No coverage gaps reported">
				{#snippet icon()}<Info size={16} weight="fill" />{/snippet}
				The provider reconstructed membership across the full range without coverage problems.
			</Callout>
		{/if}

		{#if totalSnapshots === 0}
			<Card>
				<EmptyState
					title="No membership snapshots"
					description="The provider returned no membership for this range. See the coverage gaps above."
				>
					{#snippet icon()}<Stack size={28} weight="duotone" />{/snippet}
				</EmptyState>
			</Card>
		{:else}
			<div class="snapshots">
				{#each res.membership as snapshot (snapshot.date)}
					<Card padding="sm">
						<div class="snap-head">
							<span class="snap-date">{snapshot.date}</span>
							<span class="snap-count">
								{snapshot.symbols.length} symbol{snapshot.symbols.length === 1 ? '' : 's'}
							</span>
						</div>
						{#if snapshot.symbols.length > 0}
							<ul class="symbols">
								{#each snapshot.symbols as symbol (symbol)}
									<li>{symbol}</li>
								{/each}
							</ul>
						{:else}
							<p class="hint">No members at this date.</p>
						{/if}
					</Card>
				{/each}
			</div>
		{/if}
	{:else}
		<Card>
			<EmptyState
				title="No universe resolved yet"
				description="Pick a provider and date range, then resolve to see point-in-time membership and any coverage gaps."
			>
				{#snippet icon()}<Buildings size={28} weight="duotone" />{/snippet}
			</EmptyState>
		</Card>
	{/if}
</div>

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
		max-width: 60ch;
	}
	.block {
		margin-bottom: var(--sp-5);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		max-width: 40rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
	}
	.lbl {
		font-size: var(--fs-sm);
		font-weight: 550;
		color: var(--c-text);
	}
	.textarea {
		width: 100%;
		padding: 0.4375rem 0.625rem;
		background: var(--c-bg);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		color: var(--c-text);
		font-family: var(--font-mono, monospace);
		resize: vertical;
		transition: border-color var(--dur-fast) var(--ease);
	}
	.textarea:focus-visible {
		border-color: var(--c-primary);
	}
	.hint {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
	.dates {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
	}
	.actions {
		display: flex;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}

	.results {
		margin-top: var(--sp-6);
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.result-head h2 {
		font-size: var(--fs-lg);
		font-weight: 650;
	}
	.provider-id {
		margin-top: var(--sp-1);
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
	.provider-id code {
		font-family: var(--font-mono, monospace);
		color: var(--c-text);
	}
	.gaps {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		padding-left: var(--sp-4);
		list-style: disc;
	}
	.snapshots {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.snap-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--sp-2);
		margin-bottom: var(--sp-2);
	}
	.snap-date {
		font-weight: 600;
		font-family: var(--font-mono, monospace);
	}
	.snap-count {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
	.symbols {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-1);
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.symbols li {
		padding: 0.125rem 0.4375rem;
		background: var(--c-surface-2);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		font-size: var(--fs-sm);
		font-family: var(--font-mono, monospace);
		color: var(--c-text);
	}
</style>
