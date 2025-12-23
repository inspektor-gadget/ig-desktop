/**
 * Route pattern matching utility for plugin routes.
 *
 * Supports SvelteKit-style route patterns:
 * - Static segments: /demo, /settings/profile
 * - Dynamic params: /demo/[id], /users/[userId]/posts/[postId]
 * - Catch-all: /docs/[...path]
 */

export interface RouteMatchResult {
	match: boolean;
	params: Record<string, string>;
}

export type RouteMatcher = (path: string) => RouteMatchResult;

/**
 * Create a route matcher function for a pattern.
 *
 * @param pattern Route pattern (e.g., '/demo', '/demo/[id]', '/docs/[...path]')
 * @returns Function that tests paths and extracts params
 *
 * @example
 * const matcher = createRouteMatcher('/demo/[id]');
 * matcher('/demo/123'); // { match: true, params: { id: '123' } }
 * matcher('/other');    // { match: false, params: {} }
 */
export function createRouteMatcher(pattern: string): RouteMatcher {
	const paramNames: string[] = [];

	// Normalize pattern (ensure leading slash, remove trailing slash)
	let normalizedPattern = pattern.startsWith('/') ? pattern : '/' + pattern;
	if (normalizedPattern.length > 1 && normalizedPattern.endsWith('/')) {
		normalizedPattern = normalizedPattern.slice(0, -1);
	}

	// Escape regex special chars except [ and ]
	let regexStr = normalizedPattern.replace(/[.*+?^${}()|\\]/g, '\\$&');

	// Handle catch-all [...param] - must be done first
	regexStr = regexStr.replace(/\[\.\.\.([^\]]+)\]/g, (_, name) => {
		paramNames.push(name);
		return '(.+)';
	});

	// Handle dynamic [param] segments
	regexStr = regexStr.replace(/\[([^\]]+)\]/g, (_, name) => {
		paramNames.push(name);
		return '([^/]+)';
	});

	const regex = new RegExp(`^${regexStr}$`);

	return (path: string) => {
		// Normalize path
		let normalizedPath = path.startsWith('/') ? path : '/' + path;
		if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
			normalizedPath = normalizedPath.slice(0, -1);
		}

		const match = normalizedPath.match(regex);
		if (!match) {
			return { match: false, params: {} };
		}

		const params: Record<string, string> = {};
		paramNames.forEach((name, i) => {
			params[name] = decodeURIComponent(match[i + 1]);
		});

		return { match: true, params };
	};
}

/**
 * Test if a path matches a pattern and extract params.
 * Convenience wrapper around createRouteMatcher for one-off matching.
 */
export function matchRoute(pattern: string, path: string): RouteMatchResult {
	return createRouteMatcher(pattern)(path);
}
