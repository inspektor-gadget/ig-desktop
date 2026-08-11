/**
 * Correlator tests for capture-side metadata attribution: which side
 * (requester/resolver) owns k8s/runtime/netns identity fields on a given
 * observation, and how authoritative src.k8s/dst.k8s enrichment maps onto
 * the normalized requester/nameserver endpoints.
 *
 * Run with: node --test frontend/src/lib/utils/dns/dnsCaptureMeta.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDnsCorrelation } from './dnsCorrelator.ts';
import { RICH_DNS_CONFIG, rawEvent, tsNs } from './dnsFixtures.ts';

const NOW = tsNs(60_000) / 1e6;

test('request pkt_type OUTGOING(4) attributes capture identity to the requester', () => {
	const events = [
		rawEvent({
			isResponse: false,
			tsMs: 0,
			id: 'a1',
			srcAddr: '10.244.0.4',
			srcPort: 40000,
			dstAddr: '10.96.0.10',
			dstPort: 53,
			pktTypeRaw: 4,
			k8s: { node: 'minikube', namespace: 'default', podName: 'probe', containerName: 'probe' },
			netnsId: 111
		}),
		rawEvent({
			isResponse: true,
			tsMs: 5,
			id: 'a1',
			srcAddr: '10.96.0.10',
			srcPort: 53,
			dstAddr: '10.244.0.4',
			dstPort: 40000,
			pktTypeRaw: 0,
			rcode: 'Success',
			k8s: { node: 'minikube', namespace: 'default', podName: 'probe', containerName: 'probe' },
			netnsId: 111
		})
	];
	const result = computeDnsCorrelation(events, RICH_DNS_CONFIG, NOW, { timeoutMs: 5000 });
	assert.equal(result.transactions.length, 1);
	const txn = result.transactions[0];
	assert.equal(txn.requesterMeta?.podName, 'probe');
	assert.equal(txn.requesterMeta?.namespace, 'default');
	assert.equal(txn.resolverMeta, undefined);
});

test('request pkt_type HOST(0) attributes capture identity to the resolver', () => {
	const events = [
		rawEvent({
			isResponse: false,
			tsMs: 0,
			id: 'a2',
			srcAddr: '10.244.0.4',
			srcPort: 40001,
			dstAddr: '10.244.0.2',
			dstPort: 53,
			pktTypeRaw: 0,
			k8s: {
				node: 'minikube',
				namespace: 'kube-system',
				podName: 'coredns-1',
				containerName: 'coredns'
			},
			netnsId: 222
		}),
		rawEvent({
			isResponse: true,
			tsMs: 2,
			id: 'a2',
			srcAddr: '10.244.0.2',
			srcPort: 53,
			dstAddr: '10.244.0.4',
			dstPort: 40001,
			pktTypeRaw: 4,
			rcode: 'Success',
			k8s: {
				node: 'minikube',
				namespace: 'kube-system',
				podName: 'coredns-1',
				containerName: 'coredns'
			},
			netnsId: 222
		})
	];
	const result = computeDnsCorrelation(events, RICH_DNS_CONFIG, NOW, { timeoutMs: 5000 });
	assert.equal(result.transactions.length, 1);
	const txn = result.transactions[0];
	assert.equal(txn.requesterMeta, undefined);
	assert.equal(txn.resolverMeta?.podName, 'coredns-1');
	assert.equal(txn.resolverMeta?.namespace, 'kube-system');
});

test('missing pkt_type defaults capture identity attribution to the requester', () => {
	const events = [
		{
			id: 'a3',
			qr_raw: false,
			name: 'example.com.',
			qtype_raw: 1,
			'src.addr': '10.1.1.1',
			'src.port': 41000,
			'dst.addr': '10.1.1.53',
			'dst.port': 53,
			timestamp_raw: tsNs(0),
			'k8s.namespace': 'default',
			'k8s.podName': 'no-pkt-type-pod',
			msgID: 9001
		},
		{
			id: 'a3',
			qr_raw: true,
			name: 'example.com.',
			qtype_raw: 1,
			'src.addr': '10.1.1.53',
			'src.port': 53,
			'dst.addr': '10.1.1.1',
			'dst.port': 41000,
			timestamp_raw: tsNs(5),
			rcode: 'Success',
			'k8s.namespace': 'default',
			'k8s.podName': 'no-pkt-type-pod',
			msgID: 9002
		}
	];
	const result = computeDnsCorrelation(events, RICH_DNS_CONFIG, NOW, { timeoutMs: 5000 });
	assert.equal(result.transactions.length, 1);
	const txn = result.transactions[0];
	assert.equal(txn.requesterMeta?.podName, 'no-pkt-type-pod');
	assert.equal(txn.resolverMeta, undefined);
});

test('authoritative dst.k8s enrichment on a request attaches to the resolver side', () => {
	const events = [
		rawEvent({
			isResponse: false,
			tsMs: 0,
			id: 'a4',
			srcAddr: '10.244.0.4',
			srcPort: 40002,
			dstAddr: '10.96.0.10',
			dstPort: 53,
			pktTypeRaw: 4,
			dstK8s: { kind: 'svc', name: 'kube-dns', namespace: 'kube-system' },
			k8s: { node: 'minikube', namespace: 'default', podName: 'probe' }
		}),
		rawEvent({
			isResponse: true,
			tsMs: 3,
			id: 'a4',
			srcAddr: '10.96.0.10',
			srcPort: 53,
			dstAddr: '10.244.0.4',
			dstPort: 40002,
			rcode: 'Success',
			k8s: { node: 'minikube', namespace: 'default', podName: 'probe' }
		})
	];
	const result = computeDnsCorrelation(events, RICH_DNS_CONFIG, NOW, { timeoutMs: 5000 });
	assert.equal(result.transactions.length, 1);
	const txn = result.transactions[0];
	assert.equal(txn.resolverK8s?.kind, 'svc');
	assert.equal(txn.resolverK8s?.name, 'kube-dns');
	assert.equal(txn.resolverK8s?.namespace, 'kube-system');
	assert.equal(txn.requesterK8s, undefined);
});

test('k8s.kind "raw" with an empty name is not treated as authoritative enrichment', () => {
	const events = [
		rawEvent({
			isResponse: false,
			tsMs: 0,
			id: 'a5',
			srcAddr: '10.244.0.4',
			srcPort: 40003,
			dstAddr: '10.96.0.10',
			dstPort: 53
			// srcK8s/dstK8s omitted -> rawEvent() defaults both to kind:"raw", name:""
		}),
		rawEvent({
			isResponse: true,
			tsMs: 2,
			id: 'a5',
			srcAddr: '10.96.0.10',
			srcPort: 53,
			dstAddr: '10.244.0.4',
			dstPort: 40003,
			rcode: 'Success'
		})
	];
	const result = computeDnsCorrelation(events, RICH_DNS_CONFIG, NOW, { timeoutMs: 5000 });
	const txn = result.transactions[0];
	assert.equal(txn.requesterK8s, undefined);
	assert.equal(txn.resolverK8s, undefined);
});

test('present-but-empty k8s.namespace/podName strings normalize to undefined, not empty groups', () => {
	const events = [
		rawEvent({
			isResponse: false,
			tsMs: 0,
			id: 'a6',
			srcAddr: '172.17.0.5',
			srcPort: 48000,
			dstAddr: '172.17.0.1',
			dstPort: 53,
			pktTypeRaw: 4,
			k8s: { node: '', namespace: '', podName: '', containerName: '' },
			runtime: { containerId: 'docker123', containerName: 'app', runtimeName: 'docker' }
		}),
		rawEvent({
			isResponse: true,
			tsMs: 4,
			id: 'a6',
			srcAddr: '172.17.0.1',
			srcPort: 53,
			dstAddr: '172.17.0.5',
			dstPort: 48000,
			pktTypeRaw: 0,
			rcode: 'Success',
			k8s: { node: '', namespace: '', podName: '', containerName: '' },
			runtime: { containerId: 'docker123', containerName: 'app', runtimeName: 'docker' }
		})
	];
	const result = computeDnsCorrelation(events, RICH_DNS_CONFIG, NOW, { timeoutMs: 5000 });
	const txn = result.transactions[0];
	assert.equal(txn.requesterMeta?.namespace, undefined);
	assert.equal(txn.requesterMeta?.podName, undefined);
	assert.equal(txn.requesterMeta?.runtimeContainerName, 'app');
	assert.equal(txn.requesterMeta?.runtimeName, 'docker');
});

test('capture metadata from request and response observations merges additively', () => {
	// The request only carries namespace/pod; the response (captured by the
	// same process moments later) adds container/runtime detail. Both are
	// attributed to the requester (pkt_type OUTGOING/HOST respectively), so
	// the finalized transaction should have the union of both.
	const events = [
		rawEvent({
			isResponse: false,
			tsMs: 0,
			id: 'a7',
			srcAddr: '10.244.0.4',
			srcPort: 40004,
			dstAddr: '10.96.0.10',
			dstPort: 53,
			pktTypeRaw: 4,
			k8s: { node: 'minikube', namespace: 'default', podName: 'probe', containerName: '' }
		}),
		rawEvent({
			isResponse: true,
			tsMs: 3,
			id: 'a7',
			srcAddr: '10.96.0.10',
			srcPort: 53,
			dstAddr: '10.244.0.4',
			dstPort: 40004,
			pktTypeRaw: 0,
			rcode: 'Success',
			k8s: {
				node: 'minikube',
				namespace: 'default',
				podName: 'probe',
				containerName: 'probe-main'
			},
			runtime: { containerId: 'cid-1', containerName: '', runtimeName: 'containerd' }
		})
	];
	const result = computeDnsCorrelation(events, RICH_DNS_CONFIG, NOW, { timeoutMs: 5000 });
	const txn = result.transactions[0];
	assert.equal(txn.requesterMeta?.namespace, 'default');
	assert.equal(txn.requesterMeta?.podName, 'probe');
	assert.equal(txn.requesterMeta?.containerName, 'probe-main');
	assert.equal(txn.requesterMeta?.runtimeContainerId, 'cid-1');
});
