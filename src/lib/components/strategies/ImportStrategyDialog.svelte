<script lang="ts">
	import type { StrategySpec } from '$lib/types';
	import { importSpecJSON } from '$lib/spec/serialize';
	import { Modal, Button, Callout, TextInput } from '$lib/components/ui';
	import { UploadSimple, Warning, CheckCircle } from 'phosphor-svelte';

	interface Props {
		open?: boolean;
		/** Persist the imported spec; resolves true on success. */
		onImport: (name: string, spec: StrategySpec) => Promise<boolean>;
		onClose: () => void;
	}

	let { open = $bindable(false), onImport, onClose }: Props = $props();

	let text = $state('');
	let nameOverride = $state('');
	let fileError = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let saving = $state(false);
	let fileInput = $state<HTMLInputElement>();

	// The parse result is a pure function of the pasted/loaded text.
	let parseResult = $derived.by(() => {
		const raw = text.trim();
		if (!raw) return null;
		return importSpecJSON(raw);
	});
	let parsed = $derived(parseResult?.success ? parseResult.spec : null);
	let parseError = $derived(
		fileError ?? (parseResult && !parseResult.success ? parseResult.error : null)
	);

	function reset() {
		text = '';
		nameOverride = '';
		fileError = null;
		saveError = null;
		saving = false;
	}

	function handleClose() {
		if (saving) return;
		reset();
		onClose();
	}

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fileError = null;
		try {
			text = await file.text();
		} catch {
			fileError = 'Could not read that file.';
		}
		// Allow re-selecting the same file later.
		input.value = '';
	}

	async function submit() {
		if (!parsed) return;
		saving = true;
		saveError = null;
		const name = nameOverride.trim() || parsed.name || 'Imported strategy';
		const ok = await onImport(name, parsed);
		saving = false;
		if (ok) {
			reset();
			onClose();
		} else {
			saveError = 'The strategy could not be saved. Please try again.';
		}
	}
</script>

<Modal bind:open title="Import strategy" size="md" onclose={handleClose}>
	<div class="content">
		<div class="file-row">
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json,.json"
				class="sr-only"
				onchange={onFile}
				aria-label="Choose a strategy JSON file"
			/>
			<Button variant="secondary" onclick={() => fileInput?.click()}>
				{#snippet icon()}<UploadSimple size={16} />{/snippet}
				Choose JSON file…
			</Button>
			<span class="or">or paste below</span>
		</div>

		<label class="ta-label" for="import-json">Strategy JSON</label>
		<textarea
			id="import-json"
			class="ta"
			bind:value={text}
			oninput={() => (fileError = null)}
			rows="9"
			spellcheck="false"
			placeholder={'{\n  "schemaVersion": 1,\n  "name": "My strategy",\n  ...\n}'}
			aria-invalid={parseError ? true : undefined}
			aria-describedby={parseError ? 'import-error' : undefined}></textarea>

		{#if parseError}
			<div id="import-error">
				<Callout tone="danger" title="Invalid strategy file">
					{#snippet icon()}<Warning size={16} weight="fill" />{/snippet}
					{parseError}
				</Callout>
			</div>
		{:else if parsed}
			<Callout tone="success" title="Looks good">
				{#snippet icon()}<CheckCircle size={16} weight="fill" />{/snippet}
				Parsed <strong>{parsed.name || 'Untitled'}</strong> · {parsed.indicators.length} indicator{parsed
					.indicators.length === 1
					? ''
					: 's'} · {parsed.universe.tickers.length || 'no'} ticker{parsed.universe.tickers
					.length === 1
					? ''
					: 's'}.
			</Callout>

			<TextInput
				bind:value={nameOverride}
				label="Name (optional)"
				hint="Leave blank to keep the imported name."
				placeholder={parsed.name || 'Imported strategy'}
			/>
		{/if}

		{#if saveError}
			<Callout tone="danger" title="Save failed">
				{#snippet icon()}<Warning size={16} weight="fill" />{/snippet}
				{saveError}
			</Callout>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" onclick={handleClose} disabled={saving}>Cancel</Button>
		<Button variant="primary" loading={saving} disabled={!parsed} onclick={submit}>
			Import strategy
		</Button>
	{/snippet}
</Modal>

<style>
	.content {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.file-row {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}
	.or {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
	.ta-label {
		font-size: var(--fs-sm);
		font-weight: 550;
		color: var(--c-text);
		margin-bottom: calc(-1 * var(--sp-2));
	}
	.ta {
		width: 100%;
		padding: var(--sp-3);
		background: var(--c-bg);
		border: 1px solid var(--c-border-strong);
		border-radius: var(--radius);
		color: var(--c-text);
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		line-height: var(--lh-normal);
		resize: vertical;
		transition: border-color var(--dur-fast) var(--ease);
	}
	.ta::placeholder {
		color: var(--c-text-faint);
	}
	.ta:focus-visible {
		border-color: var(--c-primary);
	}
	.ta[aria-invalid='true'] {
		border-color: var(--c-danger);
	}
</style>
