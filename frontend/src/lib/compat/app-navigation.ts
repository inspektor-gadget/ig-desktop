/**
 * Compatibility shim for $app/navigation in library mode.
 * In SvelteKit, `goto()` navigates using the SvelteKit router.
 * In library mode, the host app provides its own navigation handler.
 */

let _navigate: (url: string) => void = () => {
	console.warn('Navigation handler not set. Call setNavigationHandler() first.');
};

export function setNavigationHandler(handler: (url: string) => void): () => void {
	const previous = _navigate;
	_navigate = handler;
	return () => {
		if (_navigate === handler) _navigate = previous;
	};
}

export function goto(url: string): void {
	_navigate(url);
}
