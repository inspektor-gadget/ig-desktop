/**
 * Compatibility shim for $app/environment in library mode.
 * In SvelteKit, `browser` indicates whether the code is running in the browser.
 * In library mode, we detect this directly.
 */

export const browser = typeof window !== 'undefined';
