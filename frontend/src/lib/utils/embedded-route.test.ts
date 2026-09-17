import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embeddedRoute } from './embedded-route.ts';

test('embedded navigation covers Desktop routes without loading a router', () => {
	for (const [path, screen] of [
		['/', 'environments'],
		['/environment/create', 'create'],
		['/env/one', 'environment'],
		['/env/one/running/local-id', 'result'],
		['/browse/artifacthub', 'catalog'],
		['/browse/artifacthub/repo/gadget/1.0', 'artifact'],
		['/gadgets/run/registry.example/test:tag?env=one', 'launch'],
		['/sessions/recording', 'session'],
		['/not-supported', 'unknown']
	])
		assert.equal(embeddedRoute(path).screen, screen);
	const route = embeddedRoute('/gadgets/run/registry.example/test:tag?env=one&params=%7B%7D');
	assert.equal(route.params.path, 'registry.example/test:tag');
	assert.equal(route.url.searchParams.get('params'), '{}');
	assert.equal(embeddedRoute('/env/one%20two/').params.env, 'one two');
	for (const path of ['https://example.org', '//example.org']) {
		assert.throws(() => embeddedRoute(path), /Desktop route/);
	}
});
