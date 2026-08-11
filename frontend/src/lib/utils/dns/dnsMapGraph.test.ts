/**
 * Pure pipeline tests for the DNS map graph builder: raw trace_dns fixture
 * events -> computeDnsCorrelation -> buildDnsMapModel -> layoutDnsMapModel.
 *
 * Run with: node --test frontend/src/lib/utils/dns/dnsMapGraph.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDnsCorrelation } from './dnsCorrelator.ts';
import {
	buildDnsMapModel,
	extractDnsMapNamespaces,
	filterDnsMapModelIssuesOnly,
	filterTransactionsByNamespace,
	layoutDnsMapModel,
	dnsMapTopologyKey,
	refreshDnsMapLayoutData,
	DNS_MAP_UNGROUPED_NAMESPACE
} from './dnsMapGraph.ts';
import { buildRichDnsFixture, RICH_DNS_CONFIG, tsNs } from './dnsFixtures.ts';
import type { DnsTransaction } from './dnsTypes.ts';
import type { DnsResolverModel } from './dnsMapGraph.ts';
import type { DnsSeverityCounts } from './dnsSeverity.ts';

const TIMEOUT_MS = 5000;
/** Well past every fixture transaction's deadline, so pending sweeps finalize. */
const NOW = tsNs(60_000) / 1e6;

function correlate() {
	const events = buildRichDnsFixture();
	return computeDnsCorrelation(events, RICH_DNS_CONFIG, NOW, { timeoutMs: TIMEOUT_MS });
}

function findWorkload(
	workloads: ReturnType<typeof buildDnsMapModel>['workloads'],
	podName: string
) {
	const w = workloads.find((x) => x.podName === podName);
	assert.ok(w, `expected a workload for pod ${podName}`);
	return w!;
}

// ---------------------------------------------------------------------------
// Correlation stays correct when piped through the full fixture
// ---------------------------------------------------------------------------

test('rich fixture correlates without dropping/duplicating transactions unexpectedly', () => {
	const result = correlate();
	// 42 established earlier while iterating the fixture; pinned here so any
	// accidental regression in correlation is caught by this pipeline test
	// too, not just the unit-level correlator tests.
	assert.equal(result.transactions.length, 42);
	assert.equal(result.pendingCount, 0);
});

test('client-side and CoreDNS-side duplicate observations of the same query are both retained, not deduped', () => {
	const result = correlate();
	const dup = result.transactions.filter((t) => t.name === 'kubernetes.default.svc.cluster.local.');
	// 20 baseline (one per fixture pod) + 1 client-side dup-0001 + 1 resolver-side dup-0001 = 22.
	assert.equal(dup.length, 22);
});

// ---------------------------------------------------------------------------
// Workload grouping / stable keys
// ---------------------------------------------------------------------------

test('UDP+TCP, sidecar, and v4/v6 observations of one pod aggregate into a single workload', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const workloads = model.workloads.filter((w) => w.podName === 'frontend-5c7d6-uvwxy');
	assert.equal(workloads.length, 1, 'expected exactly one workload node for this pod');
	const w = workloads[0];
	// base + proto-udp + proto-tcp + sidecar-1 + v6-1 = 5 transactions.
	assert.equal(w.counts.total, 5);
	assert.ok(w.addresses.includes('10.244.1.14'));
	assert.ok(w.addresses.includes('fd00::1:14'));
	assert.ok(w.containerNames.includes('envoy-sidecar'));
});

test('client and resolver duplicate observations of the same workload aggregate together via address backfill', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const probe = findWorkload(model.workloads, 'dns-map-probe');
	// base-dns-map-probe (client) + dup-0001 client-side + dup-0001 resolver-side (backfilled by address) = 3.
	assert.equal(probe.counts.total, 3);
});

test('docker-only capture (present-but-empty k8s fields) falls back to the runtime container tier, not an empty namespace/pod group', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const dockerWorkload = model.workloads.find((w) => w.runtimeContainerName === 'my-app');
	assert.ok(dockerWorkload, 'expected a runtime-keyed workload for the docker-only capture');
	assert.equal(dockerWorkload!.namespaceKey, DNS_MAP_UNGROUPED_NAMESPACE);
	assert.equal(dockerWorkload!.podName, undefined);
	// No workload should ever have an empty-string namespace or pod.
	for (const w of model.workloads) {
		assert.notEqual(w.namespaceKey, '');
		assert.notEqual(w.podName, '');
	}
});

test('netns-only fallback keeps two distinct bare-netns workloads separate', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const netnsWorkloads = model.workloads.filter((w) => w.addresses[0]?.startsWith('192.168.100.'));
	assert.equal(netnsWorkloads.length, 2);
	assert.notEqual(netnsWorkloads[0].key, netnsWorkloads[1].key);
	for (const w of netnsWorkloads) assert.equal(w.namespaceKey, DNS_MAP_UNGROUPED_NAMESPACE);
});

test('namespace grouping produces exactly the 3 real k8s namespaces present, sorted', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	assert.deepEqual(model.namespaces, ['default', 'kube-system', 'monitoring']);
	assert.deepEqual(extractDnsMapNamespaces(result.transactions), model.namespaces);
});

test('20 distinct pods produce 20 pod-keyed workloads, plus fallback workloads for non-k8s captures', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const podKeyed = model.workloads.filter((w) => w.namespaceKey !== DNS_MAP_UNGROUPED_NAMESPACE);
	assert.equal(podKeyed.length, 20);
	const fallback = model.workloads.filter((w) => w.namespaceKey === DNS_MAP_UNGROUPED_NAMESPACE);
	// docker-only-1 + netns-only-a + netns-only-b = 3.
	assert.equal(fallback.length, 3);
});

// ---------------------------------------------------------------------------
// Resolver labeling
// ---------------------------------------------------------------------------

test('resolver with authoritative k8s enrichment exposes it; resolver without enrichment exposes none (no IP guessing)', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const kubeDns = model.resolvers.find((r) => r.addr === '10.96.0.10');
	assert.equal(kubeDns?.k8s?.kind, 'svc');
	assert.equal(kubeDns?.k8s?.name, 'kube-dns');
	assert.equal(kubeDns?.k8s?.namespace, 'kube-system');

	const external = model.resolvers.find((r) => r.addr === '8.8.8.8');
	assert.equal(external?.k8s, undefined);

	const dockerResolver = model.resolvers.find((r) => r.addr === '172.17.0.1');
	assert.equal(dockerResolver?.k8s, undefined);
});

// ---------------------------------------------------------------------------
// Severity ladder / counts
// ---------------------------------------------------------------------------

test('severity ladder classifies every documented edge case correctly', () => {
	const result = correlate();
	const byId = new Map<string, DnsTransaction>(result.transactions.map((t) => [t.id, t]));
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);

	// ServerFailure -> error.
	assert.equal(
		model.edges.find((e) =>
			e.transactionIds.some((id) => byId.get(id)?.name === 'flaky-upstream.example.com.')
		)?.counts.severity,
		'error'
	);
	// Refused -> error.
	assert.equal(
		model.edges.find((e) =>
			e.transactionIds.some((id) => byId.get(id)?.name === 'internal-only.corp.example.')
		)?.counts.severity,
		'error'
	);
	// Timeout (no-response) -> error.
	assert.equal(
		model.edges.find((e) =>
			e.transactionIds.some(
				(id) => byId.get(id)?.name === 'unreachable-backend.monitoring.svc.cluster.local.'
			)
		)?.counts.severity,
		'error'
	);
	// Late response -> warning.
	assert.equal(
		model.edges.find((e) =>
			e.transactionIds.some(
				(id) => byId.get(id)?.name === 'slow-control-plane.kube-system.svc.cluster.local.'
			)
		)?.counts.severity,
		'warning'
	);
	// Slow (latency >= timeoutMs/10) -> warning.
	assert.equal(
		model.edges.find((e) =>
			e.transactionIds.some(
				(id) => byId.get(id)?.name === 'overloaded-service.default.svc.cluster.local.'
			)
		)?.counts.severity,
		'warning'
	);
	// Standalone NXDOMAIN -> info.
	assert.equal(
		model.edges.find((e) =>
			e.transactionIds.some(
				(id) => byId.get(id)?.name === 'definitely-missing.default.svc.cluster.local.'
			)
		)?.counts.severity,
		'info'
	);
	// Orphan response -> info.
	assert.equal(
		model.edges.find((e) =>
			e.transactionIds.some(
				(id) => byId.get(id)?.name === 'late-arrival.default.svc.cluster.local.'
			)
		)?.counts.severity,
		'info'
	);
	// Ambiguous (mDNS) -> info.
	assert.equal(
		model.edges.find((e) =>
			e.transactionIds.some((id) => byId.get(id)?.name === '_services._dns-sd._udp.local.')
		)?.counts.severity,
		'info'
	);
	// A plain healthy pod (no edge cases attached) -> healthy.
	assert.equal(
		model.edges.find((e) =>
			e.transactionIds.some(
				(id) =>
					byId.get(id)?.name === 'kubernetes.default.svc.cluster.local.' &&
					byId.get(id)?.requester.addr === '10.244.1.11'
			)
		)?.counts.severity,
		'healthy'
	);
});

test('the NXDOMAIN search-suffix expansion series ends in success and only the intermediates count as NXDOMAIN', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const workload = findWorkload(model.workloads, 'checkout-6f9b8c-abcde');
	// base-checkout... (1, healthy) + 4 search-suffix attempts (3 NXDOMAIN + 1 success) = 5.
	assert.equal(workload.counts.total, 5);
	assert.equal(workload.counts.nxdomainCount, 3);
});

// ---------------------------------------------------------------------------
// Exact modal transaction membership
// ---------------------------------------------------------------------------

test('an edge exposes the exact transaction IDs backing it, spanning duplicate/aggregated peerKeys', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const workload = findWorkload(model.workloads, 'checkout-6f9b8c-abcde');
	const edge = model.edges.find((e) => e.workloadKey === workload.key);
	assert.ok(edge);
	assert.equal(edge!.transactionIds.length, 5);
	// Every ID must correspond to an actually-correlated transaction for this workload.
	const byId = new Map(result.transactions.map((t) => [t.id, t]));
	for (const id of edge!.transactionIds) {
		assert.ok(byId.has(id), `transaction id ${id} should exist in the correlation result`);
	}
});

// ---------------------------------------------------------------------------
// Honest filtering: namespace scopes before aggregation, issues-only is a
// post-aggregation visibility filter only.
// ---------------------------------------------------------------------------

test('namespace filter scopes transactions before aggregation (counts reflect only that namespace)', () => {
	const result = correlate();
	const scoped = filterTransactionsByNamespace(result.transactions, 'monitoring');
	const model = buildDnsMapModel(scoped, TIMEOUT_MS);
	assert.deepEqual(model.namespaces, ['monitoring']);
	for (const w of model.workloads) assert.equal(w.namespaceKey, 'monitoring');
});

test('issues-only filtering hides healthy edges but never changes underlying counts', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const totalBefore = model.edges.reduce((sum, e) => sum + e.counts.total, 0);

	const issuesOnly = filterDnsMapModelIssuesOnly(model);
	assert.ok(
		issuesOnly.edges.length < model.edges.length,
		'issues-only should hide some healthy edges'
	);
	assert.ok(issuesOnly.edges.every((e) => e.counts.severity !== 'healthy'));

	// Counts on the *retained* edges are untouched (same object references/values).
	for (const e of issuesOnly.edges) {
		const original = model.edges.find((o) => o.id === e.id);
		assert.deepEqual(e.counts, original!.counts);
	}
	const totalAfter = model.edges.reduce((sum, e) => sum + e.counts.total, 0);
	assert.equal(
		totalBefore,
		totalAfter,
		'filtering must never mutate totals computed over the full scope'
	);

	// No workload/resolver/namespace with zero remaining edges should survive.
	const survivingWorkloadKeys = new Set(issuesOnly.edges.map((e) => e.workloadKey));
	for (const w of issuesOnly.workloads) assert.ok(survivingWorkloadKeys.has(w.key));
});

// ---------------------------------------------------------------------------
// Compound layout: namespace groups and all leaf nodes never overlap, even
// at the fixture's scale (20 pods / 3 namespaces).
// ---------------------------------------------------------------------------

interface AbsRect {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	id: string;
}

function overlaps(a: AbsRect, b: AbsRect): boolean {
	return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

test('compound namespace-group layout produces zero overlaps at scale (20 pods / 3 namespaces)', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const { nodes } = layoutDnsMapModel(model, () => {});

	const byId = new Map(nodes.map((n) => [n.id, n]));
	function absRect(n: (typeof nodes)[number]): AbsRect {
		let x = n.position.x;
		let y = n.position.y;
		let parentId = n.parentId;
		while (parentId) {
			const parent = byId.get(parentId);
			if (!parent) break;
			x += parent.position.x;
			y += parent.position.y;
			parentId = parent.parentId;
		}
		const width = (n as { width?: number }).width ?? 0;
		const height = (n as { height?: number }).height ?? 0;
		return { x1: x, y1: y, x2: x + width, y2: y + height, id: n.id };
	}

	const groups = nodes.filter((n) => n.type === 'dnsNamespaceGroup');
	assert.equal(groups.length, 4, 'expected 3 real namespace groups + 1 ungrouped fallback');

	const groupRects = groups.map(absRect);
	for (let i = 0; i < groupRects.length; i++) {
		for (let j = i + 1; j < groupRects.length; j++) {
			assert.ok(
				!overlaps(groupRects[i], groupRects[j]),
				`namespace groups ${groupRects[i].id} and ${groupRects[j].id} overlap`
			);
		}
	}

	// Workload and resolver nodes need explicit dimensions (set on the group
	// nodes but not the leaves in the raw XYFlow node objects); reconstruct
	// them from the known constants for this assertion.
	const WORKLOAD_WIDTH = 220;
	const WORKLOAD_HEIGHT = 104;
	const RESOLVER_WIDTH = 200;
	const RESOLVER_HEIGHT = 84;
	const leafRects = nodes
		.filter((n) => n.type !== 'dnsNamespaceGroup')
		.map((n) => {
			const rect = absRect(n);
			const width = n.type === 'dnsWorkload' ? WORKLOAD_WIDTH : RESOLVER_WIDTH;
			const height = n.type === 'dnsWorkload' ? WORKLOAD_HEIGHT : RESOLVER_HEIGHT;
			return { ...rect, x2: rect.x1 + width, y2: rect.y1 + height };
		});
	for (let i = 0; i < leafRects.length; i++) {
		for (let j = i + 1; j < leafRects.length; j++) {
			assert.ok(
				!overlaps(leafRects[i], leafRects[j]),
				`nodes ${leafRects[i].id} and ${leafRects[j].id} overlap`
			);
		}
	}
});

test('namespace groups are stacked as vertical lanes (rankdir LR) - group centroids are predominantly vertically, not horizontally, separated', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const { nodes } = layoutDnsMapModel(model, () => {});

	const groups = nodes.filter((n) => n.type === 'dnsNamespaceGroup');
	assert.equal(groups.length, 4, 'expected 3 real namespace groups + 1 ungrouped fallback');

	const centroids = groups.map((g) => {
		const width = (g as { width?: number }).width ?? 0;
		const height = (g as { height?: number }).height ?? 0;
		return { id: g.id, x: g.position.x + width / 2, y: g.position.y + height / 2 };
	});

	// The overall spread of centroids across Y (vertical lanes) must
	// clearly dominate the spread across X (they should sit roughly in one
	// horizontal band) - the opposite of the pre-LR layout, where
	// namespaces sat side-by-side (X spread dominant, Y spread minimal).
	const xs = centroids.map((c) => c.x);
	const ys = centroids.map((c) => c.y);
	const xSpread = Math.max(...xs) - Math.min(...xs);
	const ySpread = Math.max(...ys) - Math.min(...ys);
	assert.ok(
		ySpread > xSpread * 2,
		`expected namespace group centroids to be predominantly vertically separated (ySpread=${ySpread}, xSpread=${xSpread})`
	);
});

// ---------------------------------------------------------------------------
// Layout caching: reusing positions when only data changes, recomputing
// when topology changes (see dnsMapTopologyKey/refreshDnsMapLayoutData).
// ---------------------------------------------------------------------------

test('dnsMapTopologyKey is unchanged when only counts differ, and changes when the workload/resolver/edge set differs', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);

	// Same model -> same key (determinism).
	assert.equal(dnsMapTopologyKey(model), dnsMapTopologyKey(model));

	// A model built from the exact same transactions (so identical
	// topology) still produces the identical key, independent of object
	// identity.
	const rebuilt = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	assert.equal(dnsMapTopologyKey(model), dnsMapTopologyKey(rebuilt));

	// Issues-only genuinely changes the workload/resolver/edge sets, so the
	// topology key must differ.
	const issuesOnly = filterDnsMapModelIssuesOnly(model);
	assert.notEqual(dnsMapTopologyKey(model), dnsMapTopologyKey(issuesOnly));
});

test('refreshDnsMapLayoutData reuses cached positions unchanged when topology is identical, only refreshing data', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const layout = layoutDnsMapModel(model, () => {});

	// Build a second model from the SAME transactions (same topology, and
	// since summarizeDnsSeverity/buildDnsMapModel are pure this actually
	// produces identical counts too - the point is `refreshDnsMapLayoutData`
	// must not need to differ in counts to prove it never re-lays-out;
	// what it must prove is that positions are copied through verbatim
	// without invoking Dagre again).
	const rebuiltModel = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	assert.equal(
		dnsMapTopologyKey(model),
		dnsMapTopologyKey(rebuiltModel),
		'precondition: topology must be identical for this test'
	);

	const refreshed = refreshDnsMapLayoutData(layout, rebuiltModel, () => {});

	assert.equal(refreshed.nodes.length, layout.nodes.length);
	for (let i = 0; i < layout.nodes.length; i++) {
		assert.deepEqual(
			refreshed.nodes[i].position,
			layout.nodes[i].position,
			`node ${layout.nodes[i].id} position must be reused verbatim, not recomputed`
		);
		assert.equal(refreshed.nodes[i].id, layout.nodes[i].id);
	}

	// Data is refreshed from the new model, not stale from the old layout -
	// spot check one workload's data object is the new model's instance.
	const workloadNode = refreshed.nodes.find((n) => n.type === 'dnsWorkload')!;
	const dataWorkload = (workloadNode.data as { workload: { key: string } }).workload;
	assert.ok(
		rebuiltModel.workloads.some((w) => w.key === dataWorkload.key),
		'refreshed node data must come from the new model'
	);
});

test('refreshDnsMapLayoutData is used only when topology is unchanged - a new workload changes the topology key and requires a fresh layoutDnsMapModel call', () => {
	const result = correlate();
	const model = buildDnsMapModel(result.transactions, TIMEOUT_MS);
	const layout = layoutDnsMapModel(model, () => {});

	// Simulate a genuinely new workload/edge appearing (e.g. a brand-new
	// pod started sending DNS traffic) by dropping to the issues-only
	// subset, which has a strictly smaller workload/resolver/edge set -
	// this MUST be a different topology key, so a real caller would call
	// `layoutDnsMapModel` fresh instead of `refreshDnsMapLayoutData`.
	const changedModel = filterDnsMapModelIssuesOnly(model);
	assert.notEqual(dnsMapTopologyKey(model), dnsMapTopologyKey(changedModel));

	const freshLayout = layoutDnsMapModel(changedModel, () => {});
	// The freshly laid-out node count reflects the new (smaller) topology,
	// proving a real Dagre pass ran rather than reusing the old layout's
	// (larger) node set.
	assert.notEqual(freshLayout.nodes.length, layout.nodes.length);
	const distinctNamespaceKeysInUse = new Set(changedModel.workloads.map((w) => w.namespaceKey))
		.size;
	assert.equal(
		freshLayout.nodes.length,
		changedModel.workloads.length + changedModel.resolvers.length + distinctNamespaceKeysInUse
	);
});

function emptyCounts(): DnsSeverityCounts {
	return {
		total: 0,
		errorCount: 0,
		warningCount: 0,
		infoCount: 0,
		healthyCount: 0,
		timeoutCount: 0,
		serverErrorCount: 0,
		nxdomainCount: 0,
		retryingCount: 0,
		lateCount: 0,
		slowCount: 0,
		severity: 'healthy'
	};
}

test('refreshDnsMapLayoutData matches nodes by stable id, not array position - a resolver reorder (e.g. authoritative enrichment arriving later) does not swap data between resolvers', () => {
	// Two resolvers, same keys/topology in both models, but resolver "b"
	// gains k8s enrichment in the second model. resolverSortLabel sorts
	// enriched resolvers by "namespace\u0001name" instead of "addr:port", so
	// this flips b from sorting after a to sorting before it - a genuine
	// reorder with an unchanged topology key (dnsMapTopologyKey only hashes
	// resolver *keys*, not their k8s enrichment or sort position).
	const resolverA = {
		key: 'r-a',
		addr: '10.0.0.10',
		port: 53,
		transactionIds: [],
		counts: emptyCounts()
	};
	const resolverB = {
		key: 'r-b',
		addr: '10.0.0.20',
		port: 53,
		transactionIds: [],
		counts: emptyCounts()
	};
	const workload = {
		key: 'w-1',
		namespaceKey: DNS_MAP_UNGROUPED_NAMESPACE,
		namespaceLabel: 'Other (non-Kubernetes)',
		containerNames: [],
		addresses: ['10.0.0.1'],
		transactionIds: [],
		counts: emptyCounts()
	};
	const edgeToA = {
		id: 'w-1\u0002r-a',
		workloadKey: 'w-1',
		resolverKey: 'r-a',
		transactionIds: [],
		preview: [],
		counts: emptyCounts()
	};
	const edgeToB = {
		id: 'w-1\u0002r-b',
		workloadKey: 'w-1',
		resolverKey: 'r-b',
		transactionIds: [],
		preview: [],
		counts: emptyCounts()
	};

	// Model 1: neither resolver enriched -> sorted by "addr:port", a before b.
	const model1 = {
		workloads: [workload],
		resolvers: [resolverA, resolverB],
		edges: [edgeToA, edgeToB],
		namespaces: []
	};

	// Model 2: same resolver keys, but "b" now has authoritative k8s
	// enrichment sorting it as "kube-system\u0001kube-dns", which comes
	// before the unenriched "10.0.0.10:53" label - the array order flips.
	const enrichedB = {
		...resolverB,
		k8s: { kind: 'svc', name: 'kube-dns', namespace: 'kube-system' }
	};
	const model2 = {
		workloads: [workload],
		resolvers: [enrichedB, resolverA],
		edges: [edgeToA, edgeToB],
		namespaces: []
	};
	assert.equal(
		dnsMapTopologyKey(model1),
		dnsMapTopologyKey(model2),
		'precondition: resolver key set is unchanged, only order/enrichment differs'
	);

	const layout = layoutDnsMapModel(model1, () => {});
	const refreshed = refreshDnsMapLayoutData(layout, model2, () => {});

	const resolverNodeA = refreshed.nodes.find((n) => n.id.endsWith('r-a'))!;
	const resolverNodeB = refreshed.nodes.find((n) => n.id.endsWith('r-b'))!;
	assert.equal(
		(resolverNodeA.data as { resolver: DnsResolverModel }).resolver.key,
		'r-a',
		'the node originally laid out for resolver "a" must still show resolver "a"\'s data'
	);
	assert.equal(
		(resolverNodeB.data as { resolver: DnsResolverModel }).resolver.key,
		'r-b',
		'the node originally laid out for resolver "b" must still show resolver "b"\'s data'
	);
	assert.deepEqual(
		(resolverNodeB.data as { resolver: DnsResolverModel }).resolver.k8s,
		enrichedB.k8s,
		'resolver "b" must be refreshed with its own new enrichment, not resolver "a"\'s data'
	);
	assert.equal(
		(resolverNodeA.data as { resolver: DnsResolverModel }).resolver.k8s,
		undefined,
		'resolver "a" must not pick up resolver "b"\'s enrichment via a position swap'
	);

	// Positions themselves are still reused verbatim (no re-layout), only
	// the data attached to each id-matched node changes.
	assert.deepEqual(
		resolverNodeA.position,
		layout.nodes.find((n) => n.id.endsWith('r-a'))!.position
	);
	assert.deepEqual(
		resolverNodeB.position,
		layout.nodes.find((n) => n.id.endsWith('r-b'))!.position
	);
});
