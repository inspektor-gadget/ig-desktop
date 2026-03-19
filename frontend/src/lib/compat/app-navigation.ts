/**
 * Compatibility shim for $app/navigation in library mode.
 * In SvelteKit, `goto()` navigates using the SvelteKit router.
 * In library mode, the host app provides its own navigation handler.
 */

let _navigate: (url: string) => void = () => {
	console.warn('Navigation handler not set. Call setNavigationHandler() first.');
};

export function setNavigationHandler(handler: (url: string) => void): void {
	_navigate = handler;
}

export function goto(url: string): void {
	_navigate(url);
}
