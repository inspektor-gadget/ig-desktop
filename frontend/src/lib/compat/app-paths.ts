/**
 * Compatibility shim for $app/paths in library mode.
 * In SvelteKit, these are provided by the framework.
 * In library mode, the base path is configured at initialization.
 */

let base = '';

export function setBasePath(path: string): void {
	base = path;
}

export function resolve(path: string): string {
	return base + (path.startsWith('/') ? path : '/' + path);
}

export function asset(path: string): string {
	return resolve(path);
}
