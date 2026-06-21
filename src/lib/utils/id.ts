/**
 * Stable id generation. Uses `crypto.randomUUID` (available in modern browsers
 * and Node 19+). Short, prefixed ids keep specs readable when exported as JSON.
 */

function uuid(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	// Extremely defensive fallback; never expected in supported runtimes.
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/** Create a prefixed, collision-resistant id, e.g. `ind_3f2a…`. */
export function createId(prefix: string): string {
	return `${prefix}_${uuid().replace(/-/g, '').slice(0, 12)}`;
}

export const newIndicatorId = () => createId('ind');
export const newNodeId = () => createId('node');
export const newStrategyId = () => createId('str');
export const newRunId = () => createId('run');
