/**
 * Seeded, deterministic pseudo-random number generation for the Monte-Carlo
 * validation (spec §2.7 — same seed ⇒ identical results, every run). We never
 * use `Math.random()` anywhere in the validation suite.
 *
 * `mulberry32` is a tiny, well-distributed 32-bit PRNG; good enough for
 * resampling/shuffling and fully reproducible.
 */

export interface Rng {
	/** Next float in [0, 1). */
	next(): number;
	/** Integer in [0, n). */
	int(n: number): number;
}

/** Create a deterministic RNG from a 32-bit integer seed. */
export function makeRng(seed: number): Rng {
	let a = seed >>> 0;
	const next = (): number => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int: (n: number) => Math.floor(next() * n)
	};
}

/** Fisher–Yates shuffle into a NEW array, driven by the given RNG. */
export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
	const out = xs.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = rng.int(i + 1);
		const tmp = out[i];
		out[i] = out[j];
		out[j] = tmp;
	}
	return out;
}

/** Sample `count` items from `xs` WITH replacement (bootstrap). */
export function sampleWithReplacement<T>(xs: readonly T[], count: number, rng: Rng): T[] {
	const out: T[] = [];
	if (xs.length === 0) return out;
	for (let i = 0; i < count; i++) out.push(xs[rng.int(xs.length)]);
	return out;
}
