export function embeddedRoute(path: string) {
	if (!path.startsWith('/') || path.startsWith('//')) {
		throw new Error('Expected a Desktop route beginning with /');
	}
	const url = new URL(path, 'http://localhost');
	const pathname = url.pathname.replace(/\/$/, '') || '/';
	const params: Record<string, string> = {};
	let screen = 'unknown';
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
	return { path: url.pathname + url.search + url.hash, url, params, screen };
}
