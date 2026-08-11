import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Datasource } from '../../types/charts.ts';
import { extractDnsViewConfig, showDnsNamespaceSelector } from './dnsConfig.ts';

const datasource = (annotations?: Record<string, string>): Datasource => ({
	name: 'dns',
	fields: [],
	annotations
});

test('DNS view annotations control the initial issues filter and namespace selector', () => {
	assert.deepEqual(extractDnsViewConfig(datasource()), {
		issuesOnly: false,
		namespaceSelector: true
	});
	assert.deepEqual(
		extractDnsViewConfig(
			datasource({
				'view.dns.issues-only': 'true',
				'view.dns.namespace-selector': 'false'
			})
		),
		{ issuesOnly: true, namespaceSelector: false }
	);
});

test('namespace selector requires both annotation opt-in and multiple namespaces', () => {
	assert.equal(showDnsNamespaceSelector({ issuesOnly: false, namespaceSelector: true }, 1), false);
	assert.equal(showDnsNamespaceSelector({ issuesOnly: false, namespaceSelector: true }, 2), true);
	assert.equal(showDnsNamespaceSelector({ issuesOnly: false, namespaceSelector: false }, 2), false);
});
