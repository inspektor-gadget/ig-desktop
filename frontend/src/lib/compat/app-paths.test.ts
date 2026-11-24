import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { asset, resolve, setBasePath } from './app-paths.ts';

afterEach(() => setBasePath(''));

test('resolves route IDs and slashless pathnames at the document root', () => {
	assert.equal(resolve('/'), '/');
	assert.equal(resolve('/browse/artifacthub'), '/browse/artifacthub');
	assert.equal(resolve('env/local/running/run-1'), '/env/local/running/run-1');
	assert.equal(asset('demo/config.json'), '/demo/config.json');
});

test('preserves host mount paths for navigation and static assets', () => {
	setBasePath('/host/gadgets');
	assert.equal(resolve('/'), '/host/gadgets/');
	assert.equal(resolve(''), '/host/gadgets/');
	assert.equal(resolve('/environment/create'), '/host/gadgets/environment/create');
	assert.equal(
		resolve('gadgets/run/registry.example/trace:latest?env=local#params'),
		'/host/gadgets/gadgets/run/registry.example/trace:latest?env=local#params'
	);
	assert.equal(asset('demo/sessions/session-1.json'), '/host/gadgets/demo/sessions/session-1.json');
});

test('uses the latest host mount path without retaining the previous one', () => {
	setBasePath('/first');
	assert.equal(asset('config.json'), '/first/config.json');
	setBasePath('/second');
	assert.equal(resolve('env/local'), '/second/env/local');
	assert.equal(asset('config.json'), '/second/config.json');
});
