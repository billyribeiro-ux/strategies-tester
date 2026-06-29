<script lang="ts">
	import type { ValidationReport, ValidationVerdict } from '$lib/types/validation';
	import { formatRatio, formatPercent } from '$lib/utils/format';
	import { Callout, Spinner, Badge } from '$lib/components/ui';
	import { CheckCircle, WarningCircle, XCircle } from 'phosphor-svelte';

	interface Props {
		report: ValidationReport | null;
		loading?: boolean;
		error?: string | null;
	}
	let { report, loading = false, error = null }: Props = $props();

	const VERDICT_LABEL: Record<ValidationVerdict, string> = {
		pass: 'Pass',
		warn: 'Warn',
		fail: 'Fail'
	};

	const verdictLabel = $derived(report ? VERDICT_LABEL[report.verdict] : '');

	/** Render a [0,1] probability to 2 decimals, guarding non-finite values. */
	function prob(value: number): string {
		return formatRatio(value, 2);
	}

	/** observedRank is a [0,1] fraction → human percentile. */
	function pct(value: number): string {
		return formatPercent(value, 0);
	}
</script>

<section class="validation" aria-label="Strategy validation report" aria-busy={loading}>
	{#if loading}
		<div class="state" role="status">
			<Spinner size={24} label="Running validation…" />
			<p>Running validation…</p>
		</div>
	{:else if error}
		<Callout tone="danger" title="Validation failed">
			{error}
		</Callout>
	{:else if !report}
		<Callout tone="info" title="No validation yet">
			Run an optimization to see its trust report here.
		</Callout>
	{:else if report}
		<!-- Headline verdict -->
		<header class="verdict {report.verdict}">
			<div class="verdict-head">
				<span class="verdict-badge" role="img" aria-label="Validation verdict: {verdictLabel}">
					{#if report.verdict === 'pass'}
						<CheckCircle size={20} weight="fill" aria-hidden="true" />
					{:else if report.verdict === 'warn'}
						<WarningCircle size={20} weight="fill" aria-hidden="true" />
					{:else}
						<XCircle size={20} weight="fill" aria-hidden="true" />
					{/if}
					<span>{verdictLabel}</span>
				</span>
				<h2>Validation verdict</h2>
			</div>
			{#if report.notes.length > 0}
				<ul class="notes">
					{#each report.notes as note, i (i)}
						<li>{note}</li>
					{/each}
				</ul>
			{/if}
		</header>

		<!-- Trust gates -->
		<section class="gates" aria-label="Trust gates">
			<h3 class="section-title">Trust gates</h3>
			<div class="grid">
				<!-- Deflated Sharpe -->
				<article
					class="card"
					class:pass={report.deflatedSharpe.pass}
					class:fail={!report.deflatedSharpe.pass}
				>
					<div class="card-head">
						<span class="card-label">Deflated Sharpe</span>
						<Badge tone={report.deflatedSharpe.pass ? 'long' : 'short'} size="sm">
							{report.deflatedSharpe.pass ? 'PASS' : 'FAIL'}
						</Badge>
					</div>
					<span class="card-value">{prob(report.deflatedSharpe.dsr)}</span>
					<dl class="meta">
						<div>
							<dt>PSR</dt>
							<dd>{prob(report.deflatedSharpe.psr)}</dd>
						</div>
						<div>
							<dt>E[max Sharpe]</dt>
							<dd>{formatRatio(report.deflatedSharpe.expectedMaxSharpe)}</dd>
						</div>
						<div>
							<dt>Observed Sharpe</dt>
							<dd>{formatRatio(report.deflatedSharpe.sharpe)}</dd>
						</div>
					</dl>
					<p class="hint">Pass when DSR &gt; 0.95</p>
				</article>

				<!-- PBO -->
				<article
					class="card"
					class:pass={report.pbo?.pass === true}
					class:fail={report.pbo?.pass === false}
				>
					<div class="card-head">
						<span class="card-label">PBO</span>
						{#if report.pbo}
							<Badge tone={report.pbo.pass ? 'long' : 'short'} size="sm">
								{report.pbo.pass ? 'PASS' : 'FAIL'}
							</Badge>
						{:else}
							<Badge tone="neutral" size="sm">N/A</Badge>
						{/if}
					</div>
					<span class="card-value">{report.pbo ? prob(report.pbo.pbo) : '—'}</span>
					<dl class="meta">
						{#if report.pbo}
							<div>
								<dt>Splits</dt>
								<dd>{report.pbo.nSplits}</dd>
							</div>
							<div>
								<dt>Configs</dt>
								<dd>{report.pbo.nConfigs}</dd>
							</div>
						{:else}
							<div>
								<dt>Status</dt>
								<dd>Too few trials</dd>
							</div>
						{/if}
					</dl>
					<p class="hint">Pass when PBO &lt; 0.5</p>
				</article>

				<!-- Parameter plateau -->
				<article
					class="card"
					class:pass={report.plateau?.isPlateau === true}
					class:fail={report.plateau?.isPlateau === false}
				>
					<div class="card-head">
						<span class="card-label">Parameter plateau</span>
						{#if report.plateau}
							<Badge tone={report.plateau.isPlateau ? 'long' : 'short'} size="sm">
								{report.plateau.isPlateau ? 'PLATEAU' : 'SPIKE'}
							</Badge>
						{:else}
							<Badge tone="neutral" size="sm">N/A</Badge>
						{/if}
					</div>
					<span class="card-value">{report.plateau ? prob(report.plateau.robustness) : '—'}</span>
					<dl class="meta">
						{#if report.plateau}
							<div>
								<dt>Best metric</dt>
								<dd>{formatRatio(report.plateau.bestMetric)}</dd>
							</div>
							<div>
								<dt>Neighbour mean</dt>
								<dd>{formatRatio(report.plateau.neighbourMeanMetric)}</dd>
							</div>
							<div>
								<dt>Neighbours</dt>
								<dd>{report.plateau.neighboursChecked}</dd>
							</div>
						{:else}
							<div>
								<dt>Status</dt>
								<dd>Single config</dd>
							</div>
						{/if}
					</dl>
					<p class="hint">Robustness of neighbours</p>
				</article>
			</div>
		</section>

		<!-- Monte-Carlo -->
		{#if report.tradeOrderMonteCarlo || report.bootstrap || report.randomizedEntry}
			{@const tradeMc = report.tradeOrderMonteCarlo}
			{@const boot = report.bootstrap}
			{@const rand = report.randomizedEntry}
			<section class="mc" aria-label="Monte-Carlo robustness">
				<h3 class="section-title">Monte-Carlo robustness</h3>
				<div class="grid">
					{#if tradeMc}
						<article class="card">
							<div class="card-head">
								<span class="card-label">Trade-order shuffle</span>
								<Badge tone="primary" size="sm">{pct(tradeMc.observedRank)} pct</Badge>
							</div>
							<span class="card-sub">Max-drawdown distribution</span>
							<dl class="meta">
								<div>
									<dt>Observed</dt>
									<dd>{formatRatio(tradeMc.observed)}</dd>
								</div>
								<div>
									<dt>p05</dt>
									<dd>{formatRatio(tradeMc.p05)}</dd>
								</div>
								<div>
									<dt>p50</dt>
									<dd>{formatRatio(tradeMc.p50)}</dd>
								</div>
								<div>
									<dt>p95</dt>
									<dd>{formatRatio(tradeMc.p95)}</dd>
								</div>
							</dl>
							<p class="hint">{tradeMc.iterations.toLocaleString('en-US')} iterations</p>
						</article>
					{/if}

					{#if boot}
						<article class="card">
							<div class="card-head">
								<span class="card-label">Bootstrap</span>
								<Badge tone="primary" size="sm">{pct(boot.observedRank)} pct</Badge>
							</div>
							<span class="card-sub">Total-return spread</span>
							<dl class="meta">
								<div>
									<dt>Observed</dt>
									<dd>{formatRatio(boot.observed)}</dd>
								</div>
								<div>
									<dt>p05</dt>
									<dd>{formatRatio(boot.p05)}</dd>
								</div>
								<div>
									<dt>p50</dt>
									<dd>{formatRatio(boot.p50)}</dd>
								</div>
								<div>
									<dt>p95</dt>
									<dd>{formatRatio(boot.p95)}</dd>
								</div>
							</dl>
							<p class="hint">{boot.iterations.toLocaleString('en-US')} iterations</p>
						</article>
					{/if}

					{#if rand}
						<article class="card" class:pass={rand.pass} class:fail={!rand.pass}>
							<div class="card-head">
								<span class="card-label">Randomized entry</span>
								<Badge tone={rand.pass ? 'long' : 'short'} size="sm">
									{rand.pass ? 'PASS' : 'FAIL'}
								</Badge>
							</div>
							<span class="card-sub">Observed vs random-entry null</span>
							<dl class="meta">
								<div>
									<dt>Observed</dt>
									<dd>{formatRatio(rand.observed)}</dd>
								</div>
								<div>
									<dt>Null p95</dt>
									<dd>{formatRatio(rand.p95)}</dd>
								</div>
								<div>
									<dt>Null mean</dt>
									<dd>{formatRatio(rand.nullMean)}</dd>
								</div>
								<div>
									<dt>Rank</dt>
									<dd>{pct(rand.observedRank)}</dd>
								</div>
							</dl>
							<p class="hint">Beats null at the 95th percentile</p>
						</article>
					{/if}
				</div>
			</section>
		{/if}
	{/if}
</section>

<style>
	.validation {
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

	/* ---- verdict header ---- */
	.verdict {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid;
		border-radius: var(--radius-lg);
	}
	.verdict.pass {
		background: var(--c-success-soft);
		border-color: color-mix(in oklch, var(--c-success) 35%, transparent);
	}
	.verdict.warn {
		background: var(--c-warning-soft);
		border-color: color-mix(in oklch, var(--c-warning) 35%, transparent);
	}
	.verdict.fail {
		background: var(--c-danger-soft);
		border-color: color-mix(in oklch, var(--c-danger) 35%, transparent);
	}
	.verdict-head {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.verdict-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) var(--sp-3);
		border-radius: var(--radius-full);
		font-weight: 700;
		font-size: var(--fs-sm);
		line-height: 1;
	}
	.verdict.pass .verdict-badge {
		background: var(--c-long-soft);
		color: var(--c-long);
	}
	.verdict.warn .verdict-badge {
		background: var(--c-warning-soft);
		color: var(--c-warning);
	}
	.verdict.fail .verdict-badge {
		background: var(--c-short-soft);
		color: var(--c-short);
	}
	.verdict h2 {
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--c-text);
	}
	.notes {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		margin: 0;
		padding-left: var(--sp-5);
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}

	/* ---- sections ---- */
	.section-title {
		font-size: var(--fs-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--c-text-muted);
		margin-bottom: var(--sp-3);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: var(--sp-3);
	}

	/* ---- cards ---- */
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		padding: var(--sp-3) var(--sp-4);
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-left: 3px solid var(--c-border-strong);
		border-radius: var(--radius);
		box-shadow: var(--shadow-sm);
	}
	.card.pass {
		border-left-color: var(--c-long);
	}
	.card.fail {
		border-left-color: var(--c-short);
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-2);
	}
	.card-label {
		font-size: var(--fs-xs);
		color: var(--c-text-muted);
		font-weight: 550;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.card-value {
		font-size: var(--fs-2xl);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		line-height: var(--lh-tight);
		color: var(--c-text);
	}
	.card-sub {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
	}
	.meta {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--sp-1) var(--sp-3);
		margin: 0;
		font-size: var(--fs-sm);
	}
	.meta > div {
		display: contents;
	}
	.meta dt {
		color: var(--c-text-muted);
	}
	.meta dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--c-text);
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--c-text-faint);
	}
</style>
