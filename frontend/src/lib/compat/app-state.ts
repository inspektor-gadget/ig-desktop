/**
 * Compatibility shim for $app/state in library mode.
 * In SvelteKit, `page` provides the current page URL and params.
 * In library mode, the host app provides this information via setPage().
 */

interface PageState {
	url: URL;
	params: Record<string, string>;
}

let _page: PageState = {
	url: new URL('http://localhost'),
	params: {}
};

export function setPage(pageState: Partial<PageState>): void {
	if (pageState.url) _page.url = pageState.url;
	if (pageState.params) _page.params = pageState.params;
}

/**
 * Proxy that mirrors SvelteKit's `page` object.
 * Property accesses are forwarded to the underlying mutable state.
 */
export const page: PageState = new Proxy({} as PageState, {
	get(_, prop: string) {
		return (_page as any)[prop];
	}
});
