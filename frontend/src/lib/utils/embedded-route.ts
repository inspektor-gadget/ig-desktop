const origin = 'http://localhost';

export interface EmbeddedRoute {
	/** The requested path, echoed back to the host for acknowledgement. */
	path: string;
	url: URL;
	params: Record<string, string>;
	screen: string;
}

/** Unsupported or malformed input renders the not-found screen instead of throwing. */
function notFound(path: string): EmbeddedRoute {
	return { path: String(path), url: new URL('/', origin), params: {}, screen: 'unknown' };
}

export function embeddedRoute(path: string): EmbeddedRoute {
	if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
		return notFound(path);
	}
	const url = new URL(path, origin);
	// Backslashes are slashes in special URLs: `/\host` must not resolve to another origin.
	if (url.origin !== origin) return notFound(path);
	const pathname = url.pathname.replace(/\/$/, '') || '/';
	const params: Record<string, string> = {};
	let screen = 'unknown';
	try {
		if (pathname === '/') screen = 'environments';
		else if (pathname === '/environment/create') screen = 'create';
		else if (pathname === '/browse/artifacthub') screen = 'catalog';
		else {
			const environment = pathname.match(/^\/env\/([^/]+)(?:\/running\/([^/]+))?$/);
			const session = pathname.match(/^\/sessions\/([^/]+)$/);
			const image = pathname.match(/^\/gadgets\/run\/(.+)$/);
			const artifact = pathname.match(/^\/browse\/artifacthub\/(.+)$/);
			if (environment) {
				params.env = decodeURIComponent(environment[1]);
				if (environment[2]) params.instanceID = decodeURIComponent(environment[2]);
				screen = environment[2] ? 'result' : 'environment';
			} else if (session) {
				params.id = decodeURIComponent(session[1]);
				screen = 'session';
			} else if (image || artifact) {
				params.path = decodeURIComponent((image || artifact)![1]);
				screen = image ? 'launch' : 'artifact';
			}
		}
	} catch {
		// Malformed percent-escapes.
		return notFound(path);
	}
	return { path: url.pathname + url.search + url.hash, url, params, screen };
}

/** The image a launch route for `image` would show, or undefined when it is not a plain image route. */
export function launchRouteImage(image: string): string | undefined {
	if (typeof image !== 'string' || !image) return undefined;
	const route = embeddedRoute(`/gadgets/run/${image}`);
	return route.screen === 'launch' && !route.url.search && !route.url.hash
		? route.params.path
		: undefined;
}
