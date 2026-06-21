/**
 * Capabilities contract — `GET /api/capabilities`.
 *
 * The indicator catalog, operator set, timeframes and price sources are
 * SCHEMA-DRIVEN from the backend. The builder UI renders entirely from this
 * payload; it must never hardcode the indicator list. When the backend adds an
 * indicator, the picker reflects it automatically.
 */

import type {
	FillModel,
	IndicatorType,
	Operator,
	OperatorArity,
	OrderType,
	PriceField,
	TimeframeId
} from './spec';

/** Schema for a single indicator parameter, drives the live param editors. */
export type ParamSchema =
	| {
			name: string;
			label: string;
			kind: 'int' | 'float';
			min?: number;
			max?: number;
			step?: number;
			default: number;
			unit?: string;
	  }
	| {
			name: string;
			label: string;
			kind: 'enum';
			options: { value: string; label: string }[];
			default: string;
	  }
	| { name: string; label: string; kind: 'bool'; default: boolean };

export type ParamKind = ParamSchema['kind'];

export interface IndicatorCapability {
	type: IndicatorType;
	label: string;
	description?: string;
	params: ParamSchema[];
	/**
	 * Output components. Single-output indicators expose `['value']`; multi-output
	 * indicators name each line, e.g. MACD → `['macd','signal','histogram']`,
	 * Bollinger → `['upper','middle','lower']`.
	 */
	components: string[];
	defaultPriceSource: PriceField;
	allowedPriceSources: PriceField[];
	/** Bars of warm-up before the indicator emits values (for UI hints). */
	minBars?: number;
}

export interface OperatorCapability {
	id: Operator;
	label: string;
	arity: OperatorArity;
	/** Short human description for tooltips. */
	description?: string;
}

export interface TimeframeCapability {
	id: TimeframeId;
	label: string;
	seconds: number;
	intraday: boolean;
}

export interface Capabilities {
	schemaVersion: number;
	indicators: IndicatorCapability[];
	operators: OperatorCapability[];
	timeframes: TimeframeCapability[];
	priceSources: PriceField[];
	fillModels: FillModel[];
	orderTypes: OrderType[];
}
