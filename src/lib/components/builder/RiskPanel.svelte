<script lang="ts">
	import type {
		CommissionModel,
		PositionSizing,
		ScaleOutLevel,
		ScaleOutTrigger,
		SlippageModel,
		StopLoss,
		TakeProfit,
		TrailingStop
	} from '$lib/types';
	import { assertNever } from '$lib/utils/assert-never';
	import { indicatorLabel } from '$lib/spec/defaults';
	import type { StrategyStore } from '$lib/stores/strategy.svelte';
	import {
		Button,
		Callout,
		IconButton,
		NumberInput,
		Panel,
		Select,
		TextInput
	} from '$lib/components/ui';
	import { Plus, Shield, Trash } from 'phosphor-svelte';

	interface Props {
		store: StrategyStore;
	}

	let { store }: Props = $props();

	const risk = $derived(store.spec.risk);

	const atrOptions = $derived(
		store.spec.indicators
			.filter((i) => i.type === 'atr')
			.map((i) => ({ value: i.id, label: indicatorLabel(i, store.capabilityFor(i)) }))
	);
	const hasAtr = $derived(atrOptions.length > 0);

	// --- sizing -------------------------------------------------------------

	const sizingModeOptions = [
		{ value: 'percentEquity', label: '% of equity' },
		{ value: 'riskBased', label: 'Risk-based (% per trade)' },
		{ value: 'volatilityTarget', label: 'Volatility target (ATR)' },
		{ value: 'fractionalKelly', label: 'Fractional Kelly' },
		{ value: 'fixedShares', label: 'Fixed shares' },
		{ value: 'fixedNotional', label: 'Fixed notional' }
	];

	function setSizingMode(mode: PositionSizing['mode']) {
		switch (mode) {
			case 'percentEquity':
				store.setSizing({ mode, percent: 10 });
				break;
			case 'riskBased':
				store.setSizing({ mode, riskPercent: 1 });
				break;
			case 'volatilityTarget':
				store.setSizing({ mode, targetVolPercent: 1, atrRef: atrOptions[0]?.value ?? '' });
				break;
			case 'fractionalKelly':
				store.setSizing({ mode, fraction: 0.5 });
				break;
			case 'fixedShares':
				store.setSizing({ mode, shares: 100 });
				break;
			case 'fixedNotional':
				store.setSizing({ mode, notional: 10000 });
				break;
			default:
				assertNever(mode);
		}
	}

	// --- stop loss ----------------------------------------------------------

	const stopModeOptions = [
		{ value: 'none', label: 'None' },
		{ value: 'percent', label: 'Percent' },
		{ value: 'atr', label: 'ATR multiple' },
		{ value: 'points', label: 'Points' }
	];

	function setStopMode(mode: StopLoss['mode']) {
		switch (mode) {
			case 'none':
				store.setStopLoss({ mode });
				break;
			case 'percent':
				store.setStopLoss({ mode, percent: 2 });
				break;
			case 'atr':
				store.setStopLoss({ mode, atrRef: atrOptions[0]?.value ?? '', multiple: 2 });
				break;
			case 'points':
				store.setStopLoss({ mode, points: 1 });
				break;
			default:
				assertNever(mode);
		}
	}

	// --- take profit --------------------------------------------------------

	const tpModeOptions = [
		{ value: 'none', label: 'None' },
		{ value: 'percent', label: 'Percent' },
		{ value: 'rMultiple', label: 'R multiple' },
		{ value: 'atr', label: 'ATR multiple' }
	];

	function setTpMode(mode: TakeProfit['mode']) {
		switch (mode) {
			case 'none':
				store.setTakeProfit({ mode });
				break;
			case 'percent':
				store.setTakeProfit({ mode, percent: 4 });
				break;
			case 'rMultiple':
				store.setTakeProfit({ mode, r: 2 });
				break;
			case 'atr':
				store.setTakeProfit({ mode, atrRef: atrOptions[0]?.value ?? '', multiple: 3 });
				break;
			default:
				assertNever(mode);
		}
	}

	// --- trailing stop ------------------------------------------------------

	const trailModeOptions = [
		{ value: 'none', label: 'None' },
		{ value: 'percent', label: 'Percent' },
		{ value: 'atr', label: 'ATR multiple' }
	];

	function setTrailMode(mode: TrailingStop['mode']) {
		switch (mode) {
			case 'none':
				store.setTrailingStop({ mode });
				break;
			case 'percent':
				store.setTrailingStop({ mode, percent: 3 });
				break;
			case 'atr':
				store.setTrailingStop({ mode, atrRef: atrOptions[0]?.value ?? '', multiple: 3 });
				break;
			default:
				assertNever(mode);
		}
	}

	// --- scale-out / partial profit (§4c) -----------------------------------

	const scaleOutLevels = $derived(risk.scaleOut?.levels ?? []);

	const scaleOutTriggerOptions = [
		{ value: 'percent', label: '% profit' },
		{ value: 'rMultiple', label: 'R multiple' }
	];

	/** Running sum of fractions, for the "leftover runner" hint. */
	const scaleOutFractionSum = $derived(scaleOutLevels.reduce((acc, l) => acc + l.fraction, 0));

	function commitScaleOut(levels: ScaleOutLevel[]) {
		store.setScaleOut(levels.length > 0 ? { levels } : undefined);
	}

	function addScaleOutLevel() {
		commitScaleOut([
			...scaleOutLevels,
			{ trigger: { kind: 'percent', percent: 5 }, fraction: 0.5 }
		]);
	}

	function removeScaleOutLevel(index: number) {
		commitScaleOut(scaleOutLevels.filter((_, i) => i !== index));
	}

	function setScaleOutTriggerKind(index: number, kind: ScaleOutTrigger['kind']) {
		const trigger: ScaleOutTrigger =
			kind === 'rMultiple' ? { kind: 'rMultiple', r: 2 } : { kind: 'percent', percent: 5 };
		commitScaleOut(scaleOutLevels.map((l, i) => (i === index ? { ...l, trigger } : l)));
	}

	function setScaleOutTriggerValue(index: number, value: number) {
		commitScaleOut(
			scaleOutLevels.map((l, i) => {
				if (i !== index) return l;
				const trigger: ScaleOutTrigger =
					l.trigger.kind === 'rMultiple'
						? { kind: 'rMultiple', r: value }
						: { kind: 'percent', percent: value };
				return { ...l, trigger };
			})
		);
	}

	function setScaleOutFraction(index: number, fraction: number) {
		commitScaleOut(scaleOutLevels.map((l, i) => (i === index ? { ...l, fraction } : l)));
	}

	const scaleOutNeedsStop = $derived(
		scaleOutLevels.some((l) => l.trigger.kind === 'rMultiple') && risk.stopLoss.mode === 'none'
	);

	// --- commission ---------------------------------------------------------

	const commissionModeOptions = [
		{ value: 'none', label: 'None' },
		{ value: 'perShare', label: 'Per share' },
		{ value: 'perTrade', label: 'Per trade' },
		{ value: 'percent', label: 'Percent of notional' }
	];

	function setCommissionMode(mode: CommissionModel['mode']) {
		switch (mode) {
			case 'none':
				store.setCommission({ mode });
				break;
			case 'perShare':
				store.setCommission({ mode, perShare: 0.005 });
				break;
			case 'perTrade':
				store.setCommission({ mode, perTrade: 1 });
				break;
			case 'percent':
				store.setCommission({ mode, percent: 0.05 });
				break;
			default:
				assertNever(mode);
		}
	}

	// --- slippage -----------------------------------------------------------

	const slippageModeOptions = [
		{ value: 'none', label: 'None' },
		{ value: 'percent', label: 'Percent' },
		{ value: 'ticks', label: 'Ticks' }
	];

	function setSlippageMode(mode: SlippageModel['mode']) {
		switch (mode) {
			case 'none':
				store.setSlippage({ mode });
				break;
			case 'percent':
				store.setSlippage({ mode, percent: 0.05 });
				break;
			case 'ticks':
				store.setSlippage({ mode, ticks: 1, tickSize: 0.01 });
				break;
			default:
				assertNever(mode);
		}
	}

	const riskBasedNeedsStop = $derived(
		risk.positionSizing.mode === 'riskBased' && risk.stopLoss.mode === 'none'
	);

	// --- hard-to-borrow (§5) ------------------------------------------------

	/** Comma/space-separated text for the hard-to-borrow symbol list. */
	const hardToBorrowText = $derived((risk.hardToBorrowSymbols ?? []).join(', '));

	function setHardToBorrowText(text: string) {
		store.setHardToBorrowSymbols(text.split(/[\s,]+/).filter(Boolean));
	}

	const hardToBorrowNeedsSymbols = $derived(
		(risk.hardToBorrowAPR ?? 0) > 0 && (risk.hardToBorrowSymbols ?? []).length === 0
	);
</script>

<Panel title="Risk & money management" description="Position sizing, stops, targets and costs.">
	{#snippet icon()}<Shield size={18} />{/snippet}

	<div class="sections">
		<!-- Capital & exposure -->
		<section class="block">
			<h3>Capital & exposure</h3>
			<div class="grid">
				<NumberInput
					label="Initial capital"
					suffix="$"
					min={0}
					step={1000}
					bind:value={() => risk.initialCapital, (v) => store.setInitialCapital(v)}
				/>
				<NumberInput
					label="Max concurrent positions"
					min={1}
					step={1}
					bind:value={
						() => risk.maxConcurrentPositions,
						(v) => store.setMaxConcurrentPositions(Math.max(1, Math.round(v)))
					}
				/>
				<NumberInput
					label="Pyramiding"
					hint="Extra entries per open position"
					min={0}
					step={1}
					bind:value={() => risk.pyramiding, (v) => store.setPyramiding(Math.max(0, Math.round(v)))}
				/>
				<NumberInput
					label="Max bars in trade"
					hint="Time exit, 0 = no limit"
					min={0}
					step={1}
					bind:value={
						() => risk.maxBarsInTrade ?? 0,
						(v) => store.setMaxBarsInTrade(v > 0 ? Math.round(v) : undefined)
					}
				/>
				<NumberInput
					label="Max drawdown stop"
					suffix="%"
					hint="Halt new entries past this drawdown, 0 = off"
					min={0}
					max={100}
					step={1}
					bind:value={
						() => risk.maxDrawdownStopPercent ?? 0,
						(v) => store.setMaxDrawdownStopPercent(v > 0 ? v : undefined)
					}
				/>
				<NumberInput
					label="Max portfolio heat"
					suffix="%"
					hint="Cap on total open risk, 0 = off"
					min={0}
					max={100}
					step={1}
					bind:value={
						() => risk.maxPortfolioHeatPercent ?? 0,
						(v) => store.setMaxPortfolioHeatPercent(v > 0 ? v : undefined)
					}
				/>
				<NumberInput
					label="Max correlation"
					hint="Block entries correlated with open positions, 0 = off"
					min={0}
					max={1}
					step={0.05}
					bind:value={
						() => risk.maxCorrelation ?? 0,
						(v) => store.setMaxCorrelation(v > 0 ? Math.min(1, v) : undefined)
					}
				/>
				{#if risk.maxCorrelation !== undefined}
					<NumberInput
						label="Correlation lookback"
						hint="Bars of returns to correlate (≥ 20)"
						min={1}
						step={1}
						bind:value={
							() => risk.correlationLookback ?? 60,
							(v) => store.setCorrelationLookback(v > 0 ? Math.round(v) : undefined)
						}
					/>
				{/if}
				<NumberInput
					label="Max leverage"
					suffix="×"
					hint="Gross exposure cap as a multiple of equity, 1 = cash-only"
					min={1}
					step={0.5}
					bind:value={
						() => risk.maxLeverage ?? 1, (v) => store.setMaxLeverage(v > 1 ? v : undefined)
					}
				/>
				<NumberInput
					label="Re-entry cooldown"
					hint="Bars to block a new entry on a ticker after it closes, 0 = off"
					min={0}
					step={1}
					bind:value={
						() => risk.reentryCooldownBars ?? 0,
						(v) => store.setReentryCooldownBars(v > 0 ? Math.round(v) : undefined)
					}
				/>
				<NumberInput
					label="Max positions per sector"
					hint="Cap on concurrent open positions per sector (needs live sector data), 0 = off"
					min={0}
					step={1}
					bind:value={
						() => risk.maxPositionsPerSector ?? 0,
						(v) => store.setMaxPositionsPerSector(v > 0 ? Math.round(v) : undefined)
					}
				/>
			</div>
		</section>

		<!-- Position sizing -->
		<section class="block">
			<h3>Position sizing</h3>
			<div class="grid">
				<Select
					label="Method"
					options={sizingModeOptions}
					bind:value={
						() => risk.positionSizing.mode, (v) => setSizingMode(v as PositionSizing['mode'])
					}
				/>
				{#if risk.positionSizing.mode === 'percentEquity'}
					<NumberInput
						label="Equity per trade"
						suffix="%"
						min={0}
						step={0.5}
						bind:value={
							() =>
								risk.positionSizing.mode === 'percentEquity' ? risk.positionSizing.percent : 0,
							(v) => store.setSizing({ mode: 'percentEquity', percent: v })
						}
					/>
				{:else if risk.positionSizing.mode === 'riskBased'}
					<NumberInput
						label="Risk per trade"
						suffix="%"
						min={0}
						step={0.1}
						bind:value={
							() =>
								risk.positionSizing.mode === 'riskBased' ? risk.positionSizing.riskPercent : 0,
							(v) => store.setSizing({ mode: 'riskBased', riskPercent: v })
						}
					/>
				{:else if risk.positionSizing.mode === 'volatilityTarget'}
					{#if hasAtr}
						<NumberInput
							label="Target volatility"
							suffix="%"
							hint="Equity % budgeted per ATR of risk"
							min={0}
							step={0.1}
							bind:value={
								() =>
									risk.positionSizing.mode === 'volatilityTarget'
										? risk.positionSizing.targetVolPercent
										: 0,
								(v) =>
									store.setSizing({
										mode: 'volatilityTarget',
										targetVolPercent: v,
										atrRef:
											risk.positionSizing.mode === 'volatilityTarget'
												? risk.positionSizing.atrRef
												: (atrOptions[0]?.value ?? '')
									})
							}
						/>
						<Select
							label="ATR indicator"
							options={atrOptions}
							placeholder="Select ATR"
							bind:value={
								() =>
									risk.positionSizing.mode === 'volatilityTarget' ? risk.positionSizing.atrRef : '',
								(v) =>
									store.setSizing({
										mode: 'volatilityTarget',
										atrRef: v,
										targetVolPercent:
											risk.positionSizing.mode === 'volatilityTarget'
												? risk.positionSizing.targetVolPercent
												: 1
									})
							}
						/>
					{:else}
						<Callout tone="warning">Add an ATR indicator to use volatility-target sizing.</Callout>
					{/if}
				{:else if risk.positionSizing.mode === 'fractionalKelly'}
					<NumberInput
						label="Kelly fraction"
						hint="Fraction of full Kelly (≤ 0.5 typical); sizes from closed-trade edge"
						min={0}
						max={1}
						step={0.05}
						bind:value={
							() =>
								risk.positionSizing.mode === 'fractionalKelly' ? risk.positionSizing.fraction : 0,
							(v) =>
								store.setSizing({
									mode: 'fractionalKelly',
									fraction: Math.min(1, Math.max(0.01, v))
								})
						}
					/>
				{:else if risk.positionSizing.mode === 'fixedShares'}
					<NumberInput
						label="Shares"
						min={0}
						step={1}
						bind:value={
							() => (risk.positionSizing.mode === 'fixedShares' ? risk.positionSizing.shares : 0),
							(v) => store.setSizing({ mode: 'fixedShares', shares: Math.max(0, Math.round(v)) })
						}
					/>
				{:else if risk.positionSizing.mode === 'fixedNotional'}
					<NumberInput
						label="Notional"
						suffix="$"
						min={0}
						step={1000}
						bind:value={
							() =>
								risk.positionSizing.mode === 'fixedNotional' ? risk.positionSizing.notional : 0,
							(v) => store.setSizing({ mode: 'fixedNotional', notional: v })
						}
					/>
				{/if}
			</div>
			{#if riskBasedNeedsStop}
				<Callout tone="warning">
					Risk-based sizing needs a stop loss to size from. Add a stop below or pick another sizing
					method.
				</Callout>
			{/if}
		</section>

		<!-- Stop loss -->
		<section class="block">
			<h3>Stop loss</h3>
			<div class="grid">
				<Select
					label="Type"
					options={stopModeOptions}
					bind:value={() => risk.stopLoss.mode, (v) => setStopMode(v as StopLoss['mode'])}
				/>
				{#if risk.stopLoss.mode === 'percent'}
					<NumberInput
						label="Distance"
						suffix="%"
						min={0}
						step={0.1}
						bind:value={
							() => (risk.stopLoss.mode === 'percent' ? risk.stopLoss.percent : 0),
							(v) => store.setStopLoss({ mode: 'percent', percent: v })
						}
					/>
				{:else if risk.stopLoss.mode === 'points'}
					<NumberInput
						label="Points"
						min={0}
						step={0.01}
						bind:value={
							() => (risk.stopLoss.mode === 'points' ? risk.stopLoss.points : 0),
							(v) => store.setStopLoss({ mode: 'points', points: v })
						}
					/>
				{:else if risk.stopLoss.mode === 'atr'}
					{#if hasAtr}
						<Select
							label="ATR indicator"
							options={atrOptions}
							placeholder="Select ATR"
							bind:value={
								() => (risk.stopLoss.mode === 'atr' ? risk.stopLoss.atrRef : ''),
								(v) =>
									store.setStopLoss({
										mode: 'atr',
										atrRef: v,
										multiple: risk.stopLoss.mode === 'atr' ? risk.stopLoss.multiple : 2
									})
							}
						/>
						<NumberInput
							label="Multiple"
							suffix="× ATR"
							min={0}
							step={0.1}
							bind:value={
								() => (risk.stopLoss.mode === 'atr' ? risk.stopLoss.multiple : 0),
								(v) =>
									store.setStopLoss({
										mode: 'atr',
										atrRef: risk.stopLoss.mode === 'atr' ? risk.stopLoss.atrRef : '',
										multiple: v
									})
							}
						/>
					{:else}
						<Callout tone="warning">Add an ATR indicator to use ATR-based stops.</Callout>
					{/if}
				{/if}
			</div>
		</section>

		<!-- Take profit -->
		<section class="block">
			<h3>Take profit</h3>
			<div class="grid">
				<Select
					label="Type"
					options={tpModeOptions}
					bind:value={() => risk.takeProfit.mode, (v) => setTpMode(v as TakeProfit['mode'])}
				/>
				{#if risk.takeProfit.mode === 'percent'}
					<NumberInput
						label="Distance"
						suffix="%"
						min={0}
						step={0.1}
						bind:value={
							() => (risk.takeProfit.mode === 'percent' ? risk.takeProfit.percent : 0),
							(v) => store.setTakeProfit({ mode: 'percent', percent: v })
						}
					/>
				{:else if risk.takeProfit.mode === 'rMultiple'}
					<NumberInput
						label="Reward"
						suffix="R"
						min={0}
						step={0.1}
						bind:value={
							() => (risk.takeProfit.mode === 'rMultiple' ? risk.takeProfit.r : 0),
							(v) => store.setTakeProfit({ mode: 'rMultiple', r: v })
						}
					/>
				{:else if risk.takeProfit.mode === 'atr'}
					{#if hasAtr}
						<Select
							label="ATR indicator"
							options={atrOptions}
							placeholder="Select ATR"
							bind:value={
								() => (risk.takeProfit.mode === 'atr' ? risk.takeProfit.atrRef : ''),
								(v) =>
									store.setTakeProfit({
										mode: 'atr',
										atrRef: v,
										multiple: risk.takeProfit.mode === 'atr' ? risk.takeProfit.multiple : 3
									})
							}
						/>
						<NumberInput
							label="Multiple"
							suffix="× ATR"
							min={0}
							step={0.1}
							bind:value={
								() => (risk.takeProfit.mode === 'atr' ? risk.takeProfit.multiple : 0),
								(v) =>
									store.setTakeProfit({
										mode: 'atr',
										atrRef: risk.takeProfit.mode === 'atr' ? risk.takeProfit.atrRef : '',
										multiple: v
									})
							}
						/>
					{:else}
						<Callout tone="warning">Add an ATR indicator to use ATR-based targets.</Callout>
					{/if}
				{/if}
			</div>
		</section>

		<!-- Trailing stop -->
		<section class="block">
			<h3>Trailing stop</h3>
			<div class="grid">
				<Select
					label="Type"
					options={trailModeOptions}
					bind:value={() => risk.trailingStop.mode, (v) => setTrailMode(v as TrailingStop['mode'])}
				/>
				{#if risk.trailingStop.mode === 'percent'}
					<NumberInput
						label="Distance"
						suffix="%"
						min={0}
						step={0.1}
						bind:value={
							() => (risk.trailingStop.mode === 'percent' ? risk.trailingStop.percent : 0),
							(v) => store.setTrailingStop({ mode: 'percent', percent: v })
						}
					/>
				{:else if risk.trailingStop.mode === 'atr'}
					{#if hasAtr}
						<Select
							label="ATR indicator"
							options={atrOptions}
							placeholder="Select ATR"
							bind:value={
								() => (risk.trailingStop.mode === 'atr' ? risk.trailingStop.atrRef : ''),
								(v) =>
									store.setTrailingStop({
										mode: 'atr',
										atrRef: v,
										multiple: risk.trailingStop.mode === 'atr' ? risk.trailingStop.multiple : 3
									})
							}
						/>
						<NumberInput
							label="Multiple"
							suffix="× ATR"
							min={0}
							step={0.1}
							bind:value={
								() => (risk.trailingStop.mode === 'atr' ? risk.trailingStop.multiple : 0),
								(v) =>
									store.setTrailingStop({
										mode: 'atr',
										atrRef: risk.trailingStop.mode === 'atr' ? risk.trailingStop.atrRef : '',
										multiple: v
									})
							}
						/>
					{:else}
						<Callout tone="warning">Add an ATR indicator to use ATR-based trailing stops.</Callout>
					{/if}
				{/if}
			</div>
		</section>

		<!-- Scale-out / partial profit -->
		<section class="block">
			<h3>Scale-out (partial profit)</h3>
			{#if scaleOutLevels.length === 0}
				<p class="muted">
					Take partial profits at one or more targets, leaving a runner managed by your stop /
					target / trailing logic.
				</p>
			{:else}
				<div class="levels">
					{#each scaleOutLevels as level, i (i)}
						<div class="level">
							<Select
								label="Trigger"
								options={scaleOutTriggerOptions}
								bind:value={
									() => level.trigger.kind,
									(v) => setScaleOutTriggerKind(i, v as ScaleOutTrigger['kind'])
								}
							/>
							{#if level.trigger.kind === 'rMultiple'}
								<NumberInput
									label="Reward"
									suffix="R"
									min={0}
									step={0.1}
									bind:value={
										() => (level.trigger.kind === 'rMultiple' ? level.trigger.r : 0),
										(v) => setScaleOutTriggerValue(i, v)
									}
								/>
							{:else}
								<NumberInput
									label="Profit"
									suffix="%"
									min={0}
									step={0.1}
									bind:value={
										() => (level.trigger.kind === 'percent' ? level.trigger.percent : 0),
										(v) => setScaleOutTriggerValue(i, v)
									}
								/>
							{/if}
							<NumberInput
								label="Close fraction"
								hint="Of original qty, 0–1"
								min={0}
								max={1}
								step={0.05}
								bind:value={() => level.fraction, (v) => setScaleOutFraction(i, v)}
							/>
							<IconButton
								label="Remove level"
								variant="danger"
								onclick={() => removeScaleOutLevel(i)}
							>
								<Trash size={16} />
							</IconButton>
						</div>
					{/each}
				</div>
				{#if scaleOutFractionSum > 1}
					<Callout tone="warning">
						Fractions sum to {scaleOutFractionSum.toFixed(2)} (&gt; 1) — they cannot exceed the whole
						position.
					</Callout>
				{:else if scaleOutFractionSum === 1}
					<Callout tone="info">
						Fractions sum to 1 — the levels fully close the position, leaving no runner.
					</Callout>
				{/if}
				{#if scaleOutNeedsStop}
					<Callout tone="warning">
						An R-multiple level needs a stop loss to define R. Add a stop below or use a % trigger.
					</Callout>
				{/if}
			{/if}
			<div>
				<Button size="sm" variant="ghost" onclick={addScaleOutLevel}>
					{#snippet icon()}<Plus size={16} />{/snippet}
					Add level
				</Button>
			</div>
		</section>

		<!-- Costs -->
		<section class="block">
			<h3>Trading costs</h3>
			<div class="grid">
				<Select
					label="Commission"
					options={commissionModeOptions}
					bind:value={
						() => risk.commission.mode, (v) => setCommissionMode(v as CommissionModel['mode'])
					}
				/>
				{#if risk.commission.mode === 'perShare'}
					<NumberInput
						label="Per share"
						suffix="$"
						min={0}
						step={0.001}
						bind:value={
							() => (risk.commission.mode === 'perShare' ? risk.commission.perShare : 0),
							(v) => store.setCommission({ mode: 'perShare', perShare: v })
						}
					/>
				{:else if risk.commission.mode === 'perTrade'}
					<NumberInput
						label="Per trade"
						suffix="$"
						min={0}
						step={0.1}
						bind:value={
							() => (risk.commission.mode === 'perTrade' ? risk.commission.perTrade : 0),
							(v) => store.setCommission({ mode: 'perTrade', perTrade: v })
						}
					/>
				{:else if risk.commission.mode === 'percent'}
					<NumberInput
						label="Percent"
						suffix="%"
						min={0}
						step={0.01}
						bind:value={
							() => (risk.commission.mode === 'percent' ? risk.commission.percent : 0),
							(v) => store.setCommission({ mode: 'percent', percent: v })
						}
					/>
				{/if}
			</div>
			<div class="grid">
				<Select
					label="Slippage"
					options={slippageModeOptions}
					bind:value={() => risk.slippage.mode, (v) => setSlippageMode(v as SlippageModel['mode'])}
				/>
				{#if risk.slippage.mode === 'percent'}
					<NumberInput
						label="Percent"
						suffix="%"
						min={0}
						step={0.01}
						bind:value={
							() => (risk.slippage.mode === 'percent' ? risk.slippage.percent : 0),
							(v) => store.setSlippage({ mode: 'percent', percent: v })
						}
					/>
				{:else if risk.slippage.mode === 'ticks'}
					<NumberInput
						label="Ticks"
						min={0}
						step={1}
						bind:value={
							() => (risk.slippage.mode === 'ticks' ? risk.slippage.ticks : 0),
							(v) =>
								store.setSlippage({
									mode: 'ticks',
									ticks: Math.max(0, Math.round(v)),
									tickSize: risk.slippage.mode === 'ticks' ? risk.slippage.tickSize : 0.01
								})
						}
					/>
					<NumberInput
						label="Tick size"
						suffix="$"
						min={0}
						step={0.0001}
						bind:value={
							() => (risk.slippage.mode === 'ticks' ? risk.slippage.tickSize : 0),
							(v) =>
								store.setSlippage({
									mode: 'ticks',
									ticks: risk.slippage.mode === 'ticks' ? risk.slippage.ticks : 1,
									tickSize: v
								})
						}
					/>
				{/if}
			</div>
			<div class="grid">
				<NumberInput
					label="Short borrow APR"
					suffix="%"
					hint="Annual cost to borrow shorts, 0 = none"
					min={0}
					step={0.5}
					bind:value={
						() => risk.shortBorrowAPR ?? 0, (v) => store.setShortBorrowAPR(v > 0 ? v : undefined)
					}
				/>
				<NumberInput
					label="Margin interest APR"
					suffix="%"
					hint="Annual interest on borrowed cash (needs leverage > 1), 0 = none"
					min={0}
					step={0.5}
					bind:value={
						() => risk.marginInterestAPR ?? 0,
						(v) => store.setMarginInterestAPR(v > 0 ? v : undefined)
					}
				/>
				<NumberInput
					label="Hard-to-borrow APR"
					suffix="%"
					hint="Extra borrow cost for listed shorts, on top of short borrow APR, 0 = none"
					min={0}
					step={0.5}
					bind:value={
						() => risk.hardToBorrowAPR ?? 0, (v) => store.setHardToBorrowAPR(v > 0 ? v : undefined)
					}
				/>
			</div>
			<div class="grid">
				<TextInput
					label="Hard-to-borrow symbols"
					hint="Comma-separated tickers charged the extra short borrow cost"
					placeholder="e.g. GME, AMC"
					bind:value={() => hardToBorrowText, (v) => setHardToBorrowText(v)}
				/>
			</div>
			{#if hardToBorrowNeedsSymbols}
				<Callout tone="warning">
					A hard-to-borrow APR is set but no symbols are listed — it will have no effect. Add
					tickers above or clear the APR.
				</Callout>
			{/if}
		</section>
	</div>
</Panel>

<style>
	.sections {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--sp-5);
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	h3 {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--c-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: var(--sp-3);
		align-items: start;
	}
	.muted {
		font-size: var(--fs-sm);
		color: var(--c-text-muted);
		margin: 0;
	}
	.levels {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.level {
		display: grid;
		grid-template-columns: repeat(3, minmax(6rem, 1fr)) auto;
		gap: var(--sp-3);
		align-items: end;
	}

	@media (min-width: 64rem) {
		.sections {
			grid-template-columns: 1fr 1fr;
			gap: var(--sp-5) var(--sp-6);
		}
	}
</style>
