import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDnsEndpointIdentity } from './dnsFormat.ts';

const endpoint = { addr: '10.96.0.10', port: 53 };

test('DNS endpoints prefer Kubernetes and workload identity unless raw IPs are requested', () => {
	assert.equal(
		formatDnsEndpointIdentity(
			endpoint,
			{ namespace: 'default', podName: 'client', containerName: 'app' },
			{ kind: 'pod', namespace: 'default', name: 'client' }
		),
		'pod default/client (app)'
	);
	assert.equal(
		formatDnsEndpointIdentity(endpoint, undefined, {
			kind: 'svc',
			namespace: 'kube-system',
			name: 'kube-dns'
		}),
		'svc kube-system/kube-dns'
	);
	assert.equal(formatDnsEndpointIdentity(endpoint, undefined, undefined, true), '10.96.0.10:53');
	assert.equal(formatDnsEndpointIdentity(endpoint), '10.96.0.10:53');
});
