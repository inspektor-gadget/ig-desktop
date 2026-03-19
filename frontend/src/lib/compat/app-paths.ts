/**
 * Compatibility shim for $app/paths in library mode.
 * In SvelteKit, these are provided by the framework.
 * In library mode, the base path is configured at initialization.
 *
 * Note: ES module exports are live bindings, so importers see updated values
 * after setBasePath() is called.
 */

// eslint-disable-next-line import/no-mutable-exports
export let base = '';

export function setBasePath(path: string): void {
	base = path;
}

export function resolve(path: string): string {
	return base + path;
}
