/**
 * Compatibility shim for $app/navigation in library mode.
 * In SvelteKit, `goto()` navigates using the SvelteKit router.
 * In library mode, the host app provides its own navigation handler.
 */

import { overrideStack } from '$lib/utils/override-stack';

const handlers = overrideStack<(url: string) => void>();

/** Cleanup removes only this handler, so out-of-order cleanup never reinstalls a disposed one. */
export function setNavigationHandler(handler: (url: string) => void): () => void {
	return handlers.push(handler);
}

export function goto(url: string): void {
	const navigate = handlers.current;
	if (navigate) navigate(url);
	else console.warn('Navigation handler not set. Call setNavigationHandler() first.');
}
