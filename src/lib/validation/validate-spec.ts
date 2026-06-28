/**
 * Semantic validation — produces path-keyed issues for inline display and to
 * gate the Run button. This is the rule layer that structural (zod) validation
 * can't express: reference integrity, capability conformance, operator/operand
 * compatibility, and risk-mode coherence.
 *
 * Issues carry a `path` (stable key for the offending field) and, where it
 * applies, the `nodeId` of the condition row so the UI can highlight it.
 */

import type {
	Capabilities,
	ConditionGroup,
	ConditionLeaf,
	IndicatorCapability,
	IndicatorInstance,
	Operand,
	Risk,
	RuleSection,
	StrategySpec
} from '$lib/types';
import { RULE_SECTIONS } from '$lib/types';
import { isGroup } from './guards';
import { isNumericParam, isEnumParam, isBoolParam } from './guards';

export type Severity = 'error' | 'warning';

export interface SpecIssue {
	path: string;
	message: string;
	severity: Severity;
	/** Condition-row id, when the issue belongs to a rule node. */
	nodeId?: string;
}

interface Ctx {
	issues: SpecIssue[];
	indById: Map<string, IndicatorInstance>;
	capByType: Map<string, IndicatorCapability>;
	offeredOperators: Set<string>;
	timeframeIds: Set<string>;
}

function add(ctx: Ctx, severity: Severity, path: string, message: string, nodeId?: string) {
	ctx.issues.push({ severity, path, message, nodeId });
}

// ---------------------------------------------------------------------------

export function validateSpec(spec: StrategySpec, capabilities: Capabilities): SpecIssue[] {
	const ctx: Ctx = {
		issues: [],
		indById: new Map(spec.indicators.map((i) => [i.id, i])),
		capByType: new Map(capabilities.indicators.map((c) => [c.type, c])),
		offeredOperators: new Set(capabilities.operators.map((o) => o.id)),
		timeframeIds: new Set(capabilities.timeframes.map((t) => t.id))
	};

	if (!spec.name.trim()) add(ctx, 'warning', 'name', 'Give your strategy a name.');

	validateUniverse(spec, ctx);
	validateIndicators(spec, ctx);
	validateRules(spec, ctx);
	validateRisk(spec.risk, ctx);
	validateExecution(spec, capabilities, ctx);

	return ctx.issues;
}

export function hasErrors(issues: SpecIssue[]): boolean {
	return issues.some((i) => i.severity === 'error');
}

export function issuesByNode(issues: SpecIssue[]): Map<string, SpecIssue[]> {
	const map = new Map<string, SpecIssue[]>();
	for (const issue of issues) {
		if (!issue.nodeId) continue;
		const list = map.get(issue.nodeId) ?? [];
		list.push(issue);
		map.set(issue.nodeId, list);
	}
	return map;
}

// ---------------------------------------------------------------------------

function validateUniverse(spec: StrategySpec, ctx: Ctx) {
	const u = spec.universe;
	if (u.tickers.length === 0 || u.tickers.every((t) => !t.trim())) {
		add(ctx, 'error', 'universe.tickers', 'Add at least one ticker.');
	}
	if (!ctx.timeframeIds.has(u.timeframe)) {
		add(ctx, 'error', 'universe.timeframe', `Unknown timeframe "${u.timeframe}".`);
	}
	const from = Date.parse(u.dateRange.from);
	const to = Date.parse(u.dateRange.to);
	if (Number.isNaN(from) || Number.isNaN(to)) {
		add(ctx, 'error', 'universe.dateRange', 'Enter a valid from/to date.');
	} else if (from >= to) {
		add(ctx, 'error', 'universe.dateRange', 'The "from" date must be before the "to" date.');
	}
}

function validateIndicators(spec: StrategySpec, ctx: Ctx) {
	const seen = new Set<string>();
	spec.indicators.forEach((ind, i) => {
		const base = `indicators[${i}]`;
		if (seen.has(ind.id)) add(ctx, 'error', base, 'Duplicate indicator id.');
		seen.add(ind.id);

		const cap = ctx.capByType.get(ind.type);
		if (!cap) {
			add(ctx, 'error', `${base}.type`, `Unknown indicator type "${ind.type}".`);
			return;
		}
		// Parameters
		for (const p of cap.params) {
			const path = `${base}.params.${p.name}`;
			const value = ind.params[p.name];
			if (value === undefined || value === null) {
				add(ctx, 'error', path, `Missing parameter "${p.label}".`);
				continue;
			}
			if (isNumericParam(p)) {
				if (typeof value !== 'number' || Number.isNaN(value)) {
					add(ctx, 'error', path, `"${p.label}" must be a number.`);
				} else {
					if (p.kind === 'int' && !Number.isInteger(value)) {
						add(ctx, 'error', path, `"${p.label}" must be a whole number.`);
					}
					if (p.min !== undefined && value < p.min) {
						add(ctx, 'error', path, `"${p.label}" must be ≥ ${p.min}.`);
					}
					if (p.max !== undefined && value > p.max) {
						add(ctx, 'error', path, `"${p.label}" must be ≤ ${p.max}.`);
					}
				}
			} else if (isEnumParam(p)) {
				if (!p.options.some((o) => o.value === value)) {
					add(ctx, 'error', path, `"${p.label}" has an invalid option.`);
				}
			} else if (isBoolParam(p)) {
				if (typeof value !== 'boolean') add(ctx, 'error', path, `"${p.label}" must be true/false.`);
			}
		}
		// Price source
		if (!cap.allowedPriceSources.includes(ind.priceSource)) {
			add(
				ctx,
				'warning',
				`${base}.priceSource`,
				`"${ind.priceSource}" is not a typical source for ${cap.label}.`
			);
		}
	});
}

function validateRules(spec: StrategySpec, ctx: Ctx) {
	for (const section of RULE_SECTIONS) {
		validateGroup(spec.rules[section], `rules.${section}`, section, ctx);
	}
	const longEmpty = countLeaves(spec.rules.longEntry) === 0;
	const shortEmpty = countLeaves(spec.rules.shortEntry) === 0;
	if (longEmpty && shortEmpty) {
		add(
			ctx,
			'error',
			'rules.longEntry',
			'Add at least one entry condition (long or short) — otherwise no trades are taken.'
		);
	}
	// Warn about positions that can only close at end-of-data.
	warnNoExit(spec, 'long', ctx);
	warnNoExit(spec, 'short', ctx);
}

function warnNoExit(spec: StrategySpec, side: 'long' | 'short', ctx: Ctx) {
	const entry = side === 'long' ? spec.rules.longEntry : spec.rules.shortEntry;
	const exit = side === 'long' ? spec.rules.longExit : spec.rules.shortExit;
	const hasEntry = countLeaves(entry) > 0;
	const hasExit = countLeaves(exit) > 0;
	const hasStopOrTarget =
		spec.risk.stopLoss.mode !== 'none' ||
		spec.risk.takeProfit.mode !== 'none' ||
		spec.risk.trailingStop.mode !== 'none';
	if (hasEntry && !hasExit && !hasStopOrTarget) {
		add(
			ctx,
			'warning',
			`rules.${side}Exit`,
			`No ${side} exit rule, stop or target — ${side} positions will only close at the end of the data.`
		);
	}
}

function validateGroup(group: ConditionGroup, path: string, section: RuleSection, ctx: Ctx) {
	for (const child of group.children) {
		if (isGroup(child)) {
			if (child.children.length === 0) {
				add(ctx, 'warning', `${path}.${child.id}`, 'Empty group has no effect.', child.id);
			}
			validateGroup(child, `${path}.${child.id}`, section, ctx);
		} else {
			validateLeaf(child, `${path}.${child.id}`, ctx);
		}
	}
}

function validateLeaf(leaf: ConditionLeaf, path: string, ctx: Ctx) {
	// `sequence` composes child leaves and has no operator of its own; the rest
	// carry an `op` that must be offered by the backend.
	if (leaf.kind !== 'sequence' && !ctx.offeredOperators.has(leaf.op)) {
		add(ctx, 'warning', path, `Operator "${leaf.op}" is not offered by the backend.`, leaf.id);
	}
	switch (leaf.kind) {
		case 'binary':
			validateOperand(leaf.left, `${path}.left`, leaf.id, ctx);
			validateOperand(leaf.right, `${path}.right`, leaf.id, ctx);
			break;
		case 'unary':
			validateOperand(leaf.operand, `${path}.operand`, leaf.id, ctx);
			if (leaf.operand.kind === 'constant') {
				add(
					ctx,
					'error',
					`${path}.operand`,
					'Rising/falling needs a series, not a constant.',
					leaf.id
				);
			}
			if (leaf.lookback < 1) {
				add(ctx, 'error', `${path}.lookback`, 'Lookback must be at least 1 bar.', leaf.id);
			}
			break;
		case 'range':
			validateOperand(leaf.operand, `${path}.operand`, leaf.id, ctx);
			validateOperand(leaf.lower, `${path}.lower`, leaf.id, ctx);
			validateOperand(leaf.upper, `${path}.upper`, leaf.id, ctx);
			if (leaf.lower.kind === 'constant' && leaf.upper.kind === 'constant') {
				if (leaf.lower.value >= leaf.upper.value) {
					add(
						ctx,
						'error',
						`${path}.upper`,
						'Upper bound must be greater than lower bound.',
						leaf.id
					);
				}
			}
			break;
		case 'persistence':
			validateOperand(leaf.operand, `${path}.operand`, leaf.id, ctx);
			validateOperand(leaf.threshold, `${path}.threshold`, leaf.id, ctx);
			if (!isPositiveInt(leaf.bars)) {
				add(ctx, 'error', `${path}.bars`, 'Persistence must span at least 1 bar.', leaf.id);
			}
			break;
		case 'sequence':
			if (!isPositiveInt(leaf.withinBars)) {
				add(ctx, 'error', `${path}.withinBars`, 'Within-bars must be at least 1 bar.', leaf.id);
			}
			validateLeaf(leaf.first, `${path}.first`, ctx);
			validateLeaf(leaf.second, `${path}.second`, ctx);
			break;
	}
}

function isPositiveInt(n: number): boolean {
	return Number.isInteger(n) && n >= 1;
}

function validateOperand(operand: Operand, path: string, nodeId: string, ctx: Ctx) {
	if (operand.kind === 'aggregate') {
		if (!isPositiveInt(operand.window)) {
			add(ctx, 'error', `${path}.window`, 'Aggregate window must be at least 1 bar.', nodeId);
		}
		if (!Number.isInteger(operand.offset) || operand.offset < 0) {
			add(ctx, 'error', `${path}.offset`, 'Offset must be a whole number ≥ 0.', nodeId);
		}
		if (operand.source.kind === 'constant') {
			add(
				ctx,
				'warning',
				`${path}.source`,
				'Aggregating a constant yields that constant — pick a series.',
				nodeId
			);
		}
		validateOperand(operand.source, `${path}.source`, nodeId, ctx);
		return;
	}
	if (operand.kind === 'indicator') {
		if (!operand.ref) {
			add(ctx, 'error', path, 'Choose an indicator.', nodeId);
			return;
		}
		const ind = ctx.indById.get(operand.ref);
		if (!ind) {
			add(ctx, 'error', path, 'References an indicator that no longer exists.', nodeId);
			return;
		}
		const cap = ctx.capByType.get(ind.type);
		if (cap && cap.components.length > 1) {
			if (!operand.component) {
				add(ctx, 'error', path, `Choose a component (${cap.components.join(', ')}).`, nodeId);
			} else if (!cap.components.includes(operand.component)) {
				add(
					ctx,
					'error',
					path,
					`"${operand.component}" is not a component of ${cap.label}.`,
					nodeId
				);
			}
		}
	}
}

function countLeaves(group: ConditionGroup): number {
	let n = 0;
	for (const child of group.children) {
		n += isGroup(child) ? countLeaves(child) : 1;
	}
	return n;
}

// ---------------------------------------------------------------------------

function validateRisk(risk: Risk, ctx: Ctx) {
	if (!(risk.initialCapital > 0)) {
		add(ctx, 'error', 'risk.initialCapital', 'Initial capital must be greater than 0.');
	}
	if (risk.positionSizing.mode === 'riskBased' && risk.stopLoss.mode === 'none') {
		add(
			ctx,
			'error',
			'risk.positionSizing',
			'Risk-based sizing needs a stop loss to size from. Add a stop or change the sizing mode.'
		);
	}
	if (risk.positionSizing.mode === 'percentEquity' && risk.positionSizing.percent > 100) {
		add(
			ctx,
			'warning',
			'risk.positionSizing',
			'Position size exceeds 100% of equity (uses leverage).'
		);
	}
	if (risk.maxConcurrentPositions < 1) {
		add(ctx, 'error', 'risk.maxConcurrentPositions', 'Allow at least one concurrent position.');
	}
	if (risk.pyramiding < 0) {
		add(ctx, 'error', 'risk.pyramiding', 'Pyramiding cannot be negative.');
	}
	validateAtrRef(
		risk.stopLoss.mode === 'atr' ? risk.stopLoss.atrRef : undefined,
		'risk.stopLoss',
		ctx
	);
	validateAtrRef(
		risk.takeProfit.mode === 'atr' ? risk.takeProfit.atrRef : undefined,
		'risk.takeProfit',
		ctx
	);
	validateAtrRef(
		risk.trailingStop.mode === 'atr' ? risk.trailingStop.atrRef : undefined,
		'risk.trailingStop',
		ctx
	);
}

function validateAtrRef(ref: string | undefined, path: string, ctx: Ctx) {
	if (ref === undefined) return;
	const ind = ctx.indById.get(ref);
	if (!ind) {
		add(ctx, 'error', path, 'ATR-based mode references an indicator that no longer exists.');
	} else if (ind.type !== 'atr') {
		add(ctx, 'error', path, 'ATR-based mode must reference an ATR indicator.');
	}
}

function validateExecution(spec: StrategySpec, capabilities: Capabilities, ctx: Ctx) {
	if (!capabilities.fillModels.includes(spec.execution.fillOn)) {
		add(
			ctx,
			'error',
			'execution.fillOn',
			`Fill model "${spec.execution.fillOn}" is not supported.`
		);
	}
	if (!capabilities.orderTypes.includes(spec.execution.orderType)) {
		add(
			ctx,
			'error',
			'execution.orderType',
			`Order type "${spec.execution.orderType}" is not supported.`
		);
	}
}
