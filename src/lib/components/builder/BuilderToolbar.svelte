<script lang="ts">
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import { Badge, Button, IconButton } from '$lib/components/ui';
	import { DownloadSimple, FloppyDisk, Play, UploadSimple } from 'phosphor-svelte';

	interface Props {
		store: StrategyStore;
		onrun: () => void;
		onsave: () => void;
	}

	let { store, onrun, onsave }: Props = $props();

	let fileInput = $state<HTMLInputElement>();

	function exportJSON() {
		const json = store.exportJSON();
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const safeName =
			store.spec.name
				.trim()
				.replace(/[^a-z0-9-_]+/gi, '-')
				.replace(/^-+|-+$/g, '') || 'strategy';
		const a = document.createElement('a');
		a.href = url;
		a.download = `${safeName}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	async function onFileChange(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		if (!file) return;
		const text = await file.text();
		store.importJSON(text);
		// Reset so the same file can be re-selected.
		e.currentTarget.value = '';
	}
</script>

<div class="toolbar">
	<div class="left">
		<label class="name-label" for="strategy-name">Strategy name</label>
		<input
			id="strategy-name"
			class="name-input"
			placeholder="Untitled strategy"
			bind:value={() => store.spec.name, (v) => store.setName(v)}
		/>
		{#if store.dirty}
			<Badge tone="warning" size="sm">Unsaved</Badge>
		{:else if store.savedId}
			<Badge tone="primary" size="sm">Saved</Badge>
		{/if}
	</div>

	<div class="right">
		<input
			bind:this={fileInput}
			type="file"
			name="import-json"
			accept="application/json,.json"
			class="sr-only"
			aria-hidden="true"
			tabindex="-1"
			onchange={onFileChange}
		/>
		<IconButton label="Import strategy JSON" onclick={() => fileInput?.click()}>
			<UploadSimple size={17} />
		</IconButton>
		<IconButton label="Export strategy JSON" onclick={exportJSON}>
			<DownloadSimple size={17} />
		</IconButton>
		<Button variant="secondary" onclick={onsave} loading={store.saving}>
			{#snippet icon()}<FloppyDisk size={15} />{/snippet}
			Save
		</Button>
		<Button
			variant="primary"
			onclick={onrun}
			disabled={!store.canRun}
			loading={store.running}
			title={store.canRun ? 'Run backtest' : 'Fix validation errors to run'}
		>
			{#snippet icon()}<Play size={15} weight="fill" />{/snippet}
			Run backtest
		</Button>
	</div>
</div>

{#if store.importError}
	<p class="import-error" role="alert">{store.importError}</p>
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
	}
	.left {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		min-width: 0;
		flex: 1 1 14rem;
	}
	.name-label {
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
	.name-input {
		flex: 1 1 auto;
		min-width: 8rem;
		padding: 0.4375rem 0.625rem;
		background: var(--c-bg);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		color: var(--c-text);
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.name-input:focus-visible {
		border-color: var(--c-primary);
	}
	.right {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		flex: none;
	}
	.import-error {
		margin-top: var(--sp-2);
		font-size: var(--fs-sm);
		color: var(--c-danger);
	}
</style>
