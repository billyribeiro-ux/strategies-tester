/**
 * Compile-time exhaustiveness guard. Place in the `default` branch of a switch
 * over a discriminated union: if a new variant is added, the code stops
 * compiling until every case is handled.
 */
export function assertNever(value: never, message = 'Unexpected variant'): never {
	throw new Error(`${message}: ${JSON.stringify(value)}`);
}
