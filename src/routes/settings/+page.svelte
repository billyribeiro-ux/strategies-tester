<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import { createApiClient, ApiError, type SettingsStatus } from '$lib/api/client';
	import { Button, Callout, Card, TextInput } from '$lib/components/ui';
	import {
		GearSix,
		FloppyDisk,
		Trash,
		Plug,
		CheckCircle,
		WarningCircle,
		Info
	} from 'phosphor-svelte';

	let { data }: { data: PageData } = $props();

	const api = createApiClient();

	// Seeded once from load data; mutated locally by save/clear.
	let status = $state<SettingsStatus>(untrack(() => data.status));
	let loadError = $derived(data.error);

	let keyInput = $state('');
	let saving = $state(false);
	let clearing = $state(false);
	let testing = $state(false);
	let actionError = $state<string | null>(null);
	let actionOk = $state<string | null>(null);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);

	function resetFeedback() {
		actionError = null;
		actionOk = null;
		testResult = null;
	}

	async function save() {
		const key = keyInput.trim();
		if (!key) return;
		resetFeedback();
		saving = true;
		try {
			status = await api.saveSettings(key);
			keyInput = '';
			actionOk = 'API key saved. It is stored on the server and never shown again.';
		} catch (e) {
			actionError = e instanceof ApiError ? e.message : 'Could not save the API key.';
		} finally {
			saving = false;
		}
	}

	async function clearKey() {
		resetFeedback();
		clearing = true;
		try {
			await api.clearSettings();
			status = await api.getSettings();
			actionOk = 'Stored API key cleared.';
		} catch (e) {
			actionError = e instanceof ApiError ? e.message : 'Could not clear the API key.';
		} finally {
			clearing = false;
		}
	}

	async function test() {
		resetFeedback();
		testing = true;
		try {
			testResult = await api.testFmpKey();
		} catch (e) {
			testResult = { ok: false, message: e instanceof ApiError ? e.message : 'Test failed.' };
		} finally {
			testing = false;
		}
	}

	const statusTone = $derived(
		status.source === 'db' ? 'success' : status.source === 'env' ? 'info' : 'warning'
	);
	const statusTitle = $derived(
		status.source === 'db'
			? 'API key configured'
			: status.source === 'env'
				? 'Using server environment key'
				: 'No API key configured'
	);
	const statusText = $derived(
		status.source === 'db'
			? 'An FMP API key is set via Settings and stored on the server. Backtests will use it.'
			: status.source === 'env'
				? 'Using the FMP API key from the server environment (FMP_API_KEY). Save a key below to override it.'
				: 'No FMP API key is set — backtests will fail until you add one.'
	);
</script>

<svelte:head><title>Settings · Strategy Tester</title></svelte:head>

<header class="page-head">
	<span class="head-icon"><GearSix size={26} weight="duotone" /></span>
	<div class="titles">
		<h1>Settings</h1>
		<p>Configure your Financial Modeling Prep (FMP) API key for market data.</p>
	</div>
</header>

{#if loadError}
	<div class="block">
		<Callout tone="danger" title="Couldn't load settings">
			{#snippet icon()}<WarningCircle size={16} weight="fill" />{/snippet}
			{loadError}
		</Callout>
	</div>
{/if}

<div class="block">
	<Callout tone={statusTone} title={statusTitle}>
		{#snippet icon()}
			{#if status.source === 'db'}<CheckCircle size={16} weight="fill" />
			{:else if status.source === 'env'}<Info size={16} weight="fill" />
			{:else}<WarningCircle size={16} weight="fill" />{/if}
		{/snippet}
		{statusText}
	</Callout>
</div>

<Card>
	<div class="form">
		<TextInput
			label="FMP API key"
			type="password"
			autocomplete="off"
			placeholder={status.fmpKeySet
				? '•••••••• (a key is set — enter a new one to replace)'
				: 'Paste your FMP API key'}
			hint="Stored on the server (local SQLite). It is never sent back to the browser."
			bind:value={keyInput}
		/>

		{#if actionError}
			<Callout tone="danger" title="Action failed">
				{#snippet icon()}<WarningCircle size={16} weight="fill" />{/snippet}
				{actionError}
			</Callout>
		{/if}
		{#if actionOk}
			<Callout tone="success" title="Done">
				{#snippet icon()}<CheckCircle size={16} weight="fill" />{/snippet}
				{actionOk}
			</Callout>
		{/if}
		{#if testResult}
			{@const tr = testResult}
			<Callout
				tone={tr.ok ? 'success' : 'danger'}
				title={tr.ok ? 'Connection OK' : 'Connection failed'}
			>
				{#snippet icon()}
					{#if tr.ok}
						<CheckCircle size={16} weight="fill" />
					{:else}
						<WarningCircle size={16} weight="fill" />
					{/if}
				{/snippet}
				{tr.message}
			</Callout>
		{/if}

		<div class="actions">
			<Button variant="primary" onclick={save} loading={saving} disabled={!keyInput.trim()}>
				{#snippet icon()}<FloppyDisk size={16} weight="bold" />{/snippet}
				Save key
			</Button>
			<Button variant="secondary" onclick={test} loading={testing} disabled={!status.fmpKeySet}>
				{#snippet icon()}<Plug size={16} />{/snippet}
				Test connection
			</Button>
			{#if status.source === 'db'}
				<Button variant="danger" onclick={clearKey} loading={clearing}>
					{#snippet icon()}<Trash size={16} />{/snippet}
					Clear stored key
				</Button>
			{/if}
		</div>

		<p class="getkey">
			Need a key? Create one at
			<a
				href="https://site.financialmodelingprep.com/developer/docs"
				target="_blank"
				rel="noreferrer noopener"
			>
				financialmodelingprep.com
			</a>.
		</p>
	</div>
</Card>

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
	.block {
		margin-bottom: var(--sp-5);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		max-width: 36rem;
	}
	.actions {
		display: flex;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}
	.getkey {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
</style>
