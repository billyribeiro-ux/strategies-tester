/**
 * StrategyStore — the single mutable home of the builder's `StrategySpec`.
 *
 * Every control in the visual builder edits ONE serializable spec through this
 * class. It is a Svelte 5 rune store (`$state` fields + `$derived` getters);
 * mutators keep the spec a valid discriminated union and reassign the fields
 * they touch so deep reactivity tracks the change. There is NO indicator or
 * P&L math here — running a backtest delegates to the API client, which is the
 * single source of truth for results.
 */

import type {
	Capabilities,
	CommissionModel,
	ConditionGroup,
	ConditionLeaf,
	DateRange,
	Execution,
	FillModel,
	IndicatorCapability,
	IndicatorInstance,
	LeafKind,
	OrderType,
	ParamValue,
	PositionSizing,
	PriceField,
	RuleNode,
	RuleSection,
	SavedStrategy,
	SessionSpec,
	SlippageModel,
	StopLoss,
	StrategySpec,
	TakeProfit,
	TimeframeId,
	TrailingStop
} from '$lib/types';
import {
	createDefaultSpec,
	createIndicatorInstance,
	createLeaf,
	emptyGroup
} from '$lib/spec/defaults';
import { exportSpecJSON, importSpecJSON } from '$lib/spec/serialize';
import { hasErrors, issuesByNode, validateSpec } from '$lib/validation';
import { isGroup } from '$lib/validation/guards';
import { ApiError, createApiClient } from '$lib/api/client';
import { rememberRun } from '$lib/stores/runCache';

export class StrategyStore {
	spec = $state<StrategySpec>(createDefaultSpec());
	capabilities = $state<Capabilities>() as Capabilities;
	running = $state(false);
	saving = $state(false);
	runError = $state<string | null>(null);
	saveError = $state<string | null>(null);
	importError = $state<string | null>(null);
	savedId = $state<string | null>(null);
	dirty = $state(false);
	lastSavedSnapshot = $state('');

	issues = $derived(validateSpec(this.spec, this.capabilities));
	nodeIssues = $derived(issuesByNode(this.issues));
	canRun = $derived(Boolean(this.capabilities) && !hasErrors(this.issues));
	errorCount = $derived(this.issues.filter((i) => i.severity === 'error').length);
	warningCount = $derived(this.issues.filter((i) => i.severity === 'warning').length);

	constructor(capabilities: Capabilities, spec?: StrategySpec) {
		this.capabilities = capabilities;
		this.spec = spec ?? createDefaultSpec();
		this.lastSavedSnapshot = exportSpecJSON(this.snapshot());
	}

	// --- dirty tracking -----------------------------------------------------

	private markDirty() {
		this.dirty = exportSpecJSON(this.snapshot()) !== this.lastSavedSnapshot;
	}

	private resetDirty() {
		this.lastSavedSnapshot = exportSpecJSON(this.snapshot());
		this.dirty = false;
	}

	// --- top-level ----------------------------------------------------------

	setName = (name: string) => {
		this.spec.name = name;
		this.markDirty();
	};

	// --- universe -----------------------------------------------------------

	setTickers = (tickers: string[]) => {
		this.spec.universe.tickers = [...tickers];
		this.markDirty();
	};

	addTicker = (ticker: string) => {
		const t = ticker.trim().toUpperCase();
		if (!t) return;
		if (this.spec.universe.tickers.includes(t)) return;
		this.spec.universe.tickers = [...this.spec.universe.tickers, t];
		this.markDirty();
	};

	removeTicker = (ticker: string) => {
		this.spec.universe.tickers = this.spec.universe.tickers.filter((t) => t !== ticker);
		this.markDirty();
	};

	setTimeframe = (timeframe: TimeframeId) => {
		this.spec.universe.timeframe = timeframe;
		this.markDirty();
	};

	setDateRange = (from: string, to: string) => {
		this.spec.universe.dateRange = { from, to } satisfies DateRange;
		this.markDirty();
	};

	setSession = (session: SessionSpec) => {
		this.spec.universe.session = session;
		this.markDirty();
	};

	setBenchmark = (symbol: string) => {
		this.spec.universe.benchmark = symbol.trim() || undefined;
		this.markDirty();
	};

	// --- indicators ---------------------------------------------------------

	private capByType(type: string): IndicatorCapability | undefined {
		return this.capabilities.indicators.find((c) => c.type === type);
	}

	capabilityFor = (instance: IndicatorInstance): IndicatorCapability | undefined =>
		this.capByType(instance.type);

	addIndicator = (type: string): string | undefined => {
		const cap = this.capByType(type);
		if (!cap) return undefined;
		const instance = createIndicatorInstance(cap);
		this.spec.indicators = [...this.spec.indicators, instance];
		this.markDirty();
		return instance.id;
	};

	removeIndicator = (id: string) => {
		this.spec.indicators = this.spec.indicators.filter((i) => i.id !== id);
		// Null out risk ATR refs that pointed at the removed indicator so the spec
		// stays a valid union; dangling operand refs are surfaced by validation.
		const r = this.spec.risk;
		if (r.stopLoss.mode === 'atr' && r.stopLoss.atrRef === id) {
			this.spec.risk.stopLoss = { mode: 'atr', atrRef: '', multiple: r.stopLoss.multiple };
		}
		if (r.takeProfit.mode === 'atr' && r.takeProfit.atrRef === id) {
			this.spec.risk.takeProfit = { mode: 'atr', atrRef: '', multiple: r.takeProfit.multiple };
		}
		if (r.trailingStop.mode === 'atr' && r.trailingStop.atrRef === id) {
			this.spec.risk.trailingStop = { mode: 'atr', atrRef: '', multiple: r.trailingStop.multiple };
		}
		this.markDirty();
	};

	setIndicatorParam = (id: string, name: string, value: ParamValue) => {
		const ind = this.spec.indicators.find((i) => i.id === id);
		if (!ind) return;
		ind.params = { ...ind.params, [name]: value };
		this.markDirty();
	};

	setIndicatorPriceSource = (id: string, source: PriceField) => {
		const ind = this.spec.indicators.find((i) => i.id === id);
		if (!ind) return;
		ind.priceSource = source;
		this.markDirty();
	};

	setIndicatorLabel = (id: string, label: string) => {
		const ind = this.spec.indicators.find((i) => i.id === id);
		if (!ind) return;
		ind.label = label;
		this.markDirty();
	};

	// --- rules: recursive tree helpers --------------------------------------

	/** Depth-first search for a group by id within a section's root group. */
	findGroup = (section: RuleSection, groupId: string): ConditionGroup | undefined => {
		const walk = (group: ConditionGroup): ConditionGroup | undefined => {
			if (group.id === groupId) return group;
			for (const child of group.children) {
				if (isGroup(child)) {
					const found = walk(child);
					if (found) return found;
				}
			}
			return undefined;
		};
		return walk(this.spec.rules[section]);
	};

	/** Find the parent group that directly contains `nodeId`. */
	private findParent(
		section: RuleSection,
		nodeId: string
	): { parent: ConditionGroup; index: number } | undefined {
		const walk = (group: ConditionGroup): { parent: ConditionGroup; index: number } | undefined => {
			for (let i = 0; i < group.children.length; i++) {
				const child = group.children[i];
				if (child.id === nodeId) return { parent: group, index: i };
				if (isGroup(child)) {
					const found = walk(child);
					if (found) return found;
				}
			}
			return undefined;
		};
		return walk(this.spec.rules[section]);
	}

	addLeaf = (section: RuleSection, groupId: string, kind: LeafKind = 'binary') => {
		const group = this.findGroup(section, groupId);
		if (!group) return;
		group.children = [...group.children, createLeaf(kind)];
		this.markDirty();
	};

	addGroup = (section: RuleSection, groupId: string) => {
		const group = this.findGroup(section, groupId);
		if (!group) return;
		group.children = [...group.children, emptyGroup('AND')];
		this.markDirty();
	};

	removeNode = (section: RuleSection, nodeId: string) => {
		const hit = this.findParent(section, nodeId);
		if (!hit) return; // root groups are never removed
		hit.parent.children = hit.parent.children.filter((c) => c.id !== nodeId);
		this.markDirty();
	};

	toggleGroupLogic = (section: RuleSection, groupId: string) => {
		const group = this.findGroup(section, groupId);
		if (!group) return;
		group.logic = group.logic === 'AND' ? 'OR' : 'AND';
		this.markDirty();
	};

	setGroupLogic = (section: RuleSection, groupId: string, logic: 'AND' | 'OR') => {
		const group = this.findGroup(section, groupId);
		if (!group) return;
		group.logic = logic;
		this.markDirty();
	};

	replaceLeaf = (section: RuleSection, nodeId: string, newLeaf: ConditionLeaf) => {
		const hit = this.findParent(section, nodeId);
		if (!hit) return;
		const next = [...hit.parent.children];
		next[hit.index] = newLeaf;
		hit.parent.children = next;
		this.markDirty();
	};

	/** Replace an arbitrary node (leaf or group) in place — used by editors. */
	replaceNode = (section: RuleSection, nodeId: string, node: RuleNode) => {
		const hit = this.findParent(section, nodeId);
		if (!hit) return;
		const next = [...hit.parent.children];
		next[hit.index] = node;
		hit.parent.children = next;
		this.markDirty();
	};

	moveNode = (section: RuleSection, groupId: string, fromIndex: number, toIndex: number) => {
		const group = this.findGroup(section, groupId);
		if (!group) return;
		const n = group.children.length;
		if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n || fromIndex === toIndex) {
			return;
		}
		const next = [...group.children];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved);
		group.children = next;
		this.markDirty();
	};

	// --- risk ---------------------------------------------------------------

	setInitialCapital = (value: number) => {
		this.spec.risk.initialCapital = value;
		this.markDirty();
	};

	setMaxConcurrentPositions = (value: number) => {
		this.spec.risk.maxConcurrentPositions = value;
		this.markDirty();
	};

	setPyramiding = (value: number) => {
		this.spec.risk.pyramiding = value;
		this.markDirty();
	};

	setSizing = (sizing: PositionSizing) => {
		this.spec.risk.positionSizing = sizing;
		this.markDirty();
	};

	setStopLoss = (stop: StopLoss) => {
		this.spec.risk.stopLoss = stop;
		this.markDirty();
	};

	setTakeProfit = (tp: TakeProfit) => {
		this.spec.risk.takeProfit = tp;
		this.markDirty();
	};

	setTrailingStop = (ts: TrailingStop) => {
		this.spec.risk.trailingStop = ts;
		this.markDirty();
	};

	setCommission = (c: CommissionModel) => {
		this.spec.risk.commission = c;
		this.markDirty();
	};

	setSlippage = (s: SlippageModel) => {
		this.spec.risk.slippage = s;
		this.markDirty();
	};

	// --- execution ----------------------------------------------------------

	setFillModel = (fillOn: FillModel) => {
		this.spec.execution.fillOn = fillOn;
		this.markDirty();
	};

	setOrderType = (orderType: OrderType) => {
		this.spec.execution.orderType = orderType;
		this.markDirty();
	};

	setExecution = (execution: Execution) => {
		this.spec.execution = execution;
		this.markDirty();
	};

	/**
	 * Set the liquidity cap (max % of bar volume, §2.3). A non-positive or NaN
	 * value clears the cap (undefined = uncapped).
	 */
	setExecutionLiquidityCap = (pct: number | undefined) => {
		this.spec.execution.maxBarVolumePct =
			typeof pct === 'number' && Number.isFinite(pct) && pct > 0 ? pct : undefined;
		this.markDirty();
	};

	// --- serialization ------------------------------------------------------

	snapshot = (): StrategySpec => $state.snapshot(this.spec);

	exportJSON = (): string => exportSpecJSON(this.snapshot());

	importJSON = (text: string): boolean => {
		const result = importSpecJSON(text);
		if (!result.success) {
			this.importError = result.error;
			return false;
		}
		this.importError = null;
		this.spec = result.spec;
		this.markDirty();
		return true;
	};

	// --- backend ------------------------------------------------------------

	/** Run a backtest; returns the run id on success, null on failure. */
	run = async (): Promise<string | null> => {
		this.running = true;
		this.runError = null;
		try {
			const res = await createApiClient().runBacktest(this.snapshot());
			// Carry the result in-hand to the results page so it renders without a
			// second round-trip (which would 404 if the run is evicted from the
			// ephemeral DB before the results `load` fetches it). See runCache.
			rememberRun(res);
			return res.runId;
		} catch (err) {
			this.runError = err instanceof ApiError ? err.message : 'Backtest failed. Please try again.';
			return null;
		} finally {
			this.running = false;
		}
	};

	/** Create (or update an existing) saved strategy. */
	save = async (name?: string): Promise<SavedStrategy | null> => {
		this.saving = true;
		this.saveError = null;
		if (name && name.trim()) this.setName(name.trim());
		try {
			const api = createApiClient();
			const snapshot = this.snapshot();
			const saved = this.savedId
				? await api.updateStrategy(this.savedId, { name: snapshot.name, spec: snapshot })
				: await api.createStrategy({ name: snapshot.name, spec: snapshot });
			this.savedId = saved.id;
			this.resetDirty();
			return saved;
		} catch (err) {
			this.saveError = err instanceof ApiError ? err.message : 'Could not save the strategy.';
			return null;
		} finally {
			this.saving = false;
		}
	};
}
