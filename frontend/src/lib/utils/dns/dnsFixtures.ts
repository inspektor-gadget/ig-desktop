/**
 * Deterministic, realistic raw `trace_dns` event fixtures for tests (and the
 * Playwright visual harness demo data, which derives its session from this
 * same fixture so screenshots and pipeline tests exercise identical data).
 *
 * Everything here produces RAW events (the same shape the gadget emits) -
 * never hand-authored `DnsTransaction` rows - so fixture data is always
 * piped through the real `computeDnsCorrelation` -> `buildDnsMapModel`
 * pipeline, the same as production.
 */

import type { DnsFieldConfig } from './dnsTypes.ts';

/** Full field-name mapping, matching what `extractDnsConfig` produces for a fully-enriched trace_dns datasource. */
export const RICH_DNS_CONFIG: DnsFieldConfig = {
	idField: 'id',
	qrField: 'qr_raw',
	nameField: 'name',
	qtypeField: 'qtype_raw',
	qtypeDisplayField: 'qtype',
	srcAddrField: 'src.addr',
	srcPortField: 'src.port',
	dstAddrField: 'dst.addr',
	dstPortField: 'dst.port',
	protoField: 'src.proto',
	timestampField: 'timestamp_raw',
	latencyField: 'latency_ns_raw',
	rcodeField: 'rcode_raw',
	rcodeDisplayField: 'rcode',
	numAnswersField: 'num_answers',
	addressesField: 'addresses',
	pktTypeField: 'pkt_type_raw',
	pktTypeDisplayField: 'pkt_type',
	identityFields: ['k8s.node', 'k8s.namespace', 'k8s.podName', 'k8s.containerName', 'netns_id'],
	k8sNodeField: 'k8s.node',
	k8sNamespaceField: 'k8s.namespace',
	k8sPodNameField: 'k8s.podName',
	k8sContainerNameField: 'k8s.containerName',
	runtimeContainerIdField: 'runtime.containerId',
	runtimeContainerNameField: 'runtime.containerName',
	runtimeNameField: 'runtime.runtimeName',
	netnsIdField: 'netns_id',
	srcK8sKindField: 'src.k8s.kind',
	srcK8sNameField: 'src.k8s.name',
	srcK8sNamespaceField: 'src.k8s.namespace',
	dstK8sKindField: 'dst.k8s.kind',
	dstK8sNameField: 'dst.k8s.name',
	dstK8sNamespaceField: 'dst.k8s.namespace'
};

/** Realistic epoch-ns base (~2026-08-13), matching the live minikube capture window. */
export const FIXTURE_BASE_NS = 1_786_593_000_000_000_000;

export function tsNs(offsetMs: number): number {
	return FIXTURE_BASE_NS + offsetMs * 1e6;
}

let nextMsgId = 0;
/** Reset the deterministic msgID counter (call at the start of each test that needs stable IDs). */
export function resetFixtureMsgId(): void {
	nextMsgId = 0;
}

export const RESOLVER_KUBE_DNS = { addr: '10.96.0.10', port: 53 };
export const RESOLVER_COREDNS_POD_A = { addr: '10.244.0.2', port: 53 };
export const RESOLVER_COREDNS_POD_B = { addr: '10.244.0.9', port: 53 };
export const RESOLVER_EXTERNAL = { addr: '8.8.8.8', port: 53 };
export const RESOLVER_NODE_LOCAL = { addr: '169.254.20.10', port: 53 };

interface K8sRefOpts {
	kind: string;
	name: string;
	namespace?: string;
}

interface RawEventOpts {
	isResponse: boolean;
	tsMs: number;
	id: string;
	name?: string;
	qtypeRaw?: number;
	srcAddr: string;
	srcPort: number;
	dstAddr: string;
	dstPort: number;
	proto?: string;
	pktTypeRaw?: number;
	latencyNsRaw?: number;
	rcode?: string;
	numAnswers?: number;
	addresses?: string;
	/** k8s.* identity fields, present (possibly as empty strings for a Docker-only capture) whenever the capture reports Kubernetes context at all. Omit entirely to simulate a capture with no k8s enrichment (netns-only fallback). */
	k8s?: { node?: string; namespace?: string; podName?: string; containerName?: string };
	runtime?: { containerId?: string; containerName?: string; runtimeName?: string };
	netnsId?: number;
	srcK8s?: K8sRefOpts;
	dstK8s?: K8sRefOpts;
}

/** Build one raw trace_dns event with the full field set a real capture may report. */
export function rawEvent(opts: RawEventOpts): Record<string, unknown> {
	const event: Record<string, unknown> = {
		id: opts.id,
		qr_raw: opts.isResponse,
		name: opts.name ?? 'example.default.svc.cluster.local.',
		qtype_raw: opts.qtypeRaw ?? 1,
		qtype: opts.qtypeRaw === 28 ? 'AAAA' : 'A',
		'src.addr': opts.srcAddr,
		'src.port': opts.srcPort,
		'dst.addr': opts.dstAddr,
		'dst.port': opts.dstPort,
		'src.proto': opts.proto ?? 'UDP',
		timestamp_raw: tsNs(opts.tsMs),
		latency_ns_raw: opts.latencyNsRaw ?? 0,
		rcode: opts.rcode ?? (opts.isResponse ? 'Success' : ''),
		rcode_raw: rcodeNameToRaw(opts.rcode),
		num_answers: opts.numAnswers ?? (opts.isResponse ? 1 : 0),
		addresses: opts.addresses ?? '',
		pkt_type_raw: opts.pktTypeRaw ?? (opts.isResponse ? 0 : 4),
		pkt_type: pktTypeRawToName(opts.pktTypeRaw ?? (opts.isResponse ? 0 : 4)),
		msgID: nextMsgId++
	};

	if (opts.k8s) {
		event['k8s.node'] = opts.k8s.node ?? '';
		event['k8s.namespace'] = opts.k8s.namespace ?? '';
		event['k8s.podName'] = opts.k8s.podName ?? '';
		event['k8s.containerName'] = opts.k8s.containerName ?? '';
	}
	if (opts.runtime) {
		event['runtime.containerId'] = opts.runtime.containerId ?? '';
		event['runtime.containerName'] = opts.runtime.containerName ?? '';
		event['runtime.runtimeName'] = opts.runtime.runtimeName ?? '';
	}
	if (opts.netnsId !== undefined) event['netns_id'] = opts.netnsId;
	if (opts.srcK8s) {
		event['src.k8s.kind'] = opts.srcK8s.kind;
		event['src.k8s.name'] = opts.srcK8s.name;
		event['src.k8s.namespace'] = opts.srcK8s.namespace ?? '';
	} else {
		event['src.k8s.kind'] = 'raw';
		event['src.k8s.name'] = '';
		event['src.k8s.namespace'] = '';
	}
	if (opts.dstK8s) {
		event['dst.k8s.kind'] = opts.dstK8s.kind;
		event['dst.k8s.name'] = opts.dstK8s.name;
		event['dst.k8s.namespace'] = opts.dstK8s.namespace ?? '';
	} else {
		event['dst.k8s.kind'] = 'raw';
		event['dst.k8s.name'] = '';
		event['dst.k8s.namespace'] = '';
	}

	return event;
}

function rcodeNameToRaw(rcode: string | undefined): number {
	switch (rcode) {
		case 'FormatError':
			return 1;
		case 'ServerFailure':
			return 2;
		case 'NameError':
			return 3;
		case 'NotImplemented':
			return 4;
		case 'Refused':
			return 5;
		default:
			return 0; // Success (also used for requests, which carry no rcode)
	}
}

function pktTypeRawToName(raw: number): string {
	switch (raw) {
		case 1:
			return 'BROADCAST';
		case 2:
			return 'MULTICAST';
		case 4:
			return 'OUTGOING';
		default:
			return 'HOST';
	}
}

export interface FixturePod {
	namespace: string;
	pod: string;
	addr: string;
	addrV6?: string;
	netns: number;
	node?: string;
}

/** 20 pods across 3 namespaces (7 default, 7 kube-system, 6 monitoring), for grouping/scale tests. */
export const FIXTURE_PODS: FixturePod[] = [
	// default (7)
	{ namespace: 'default', pod: 'checkout-6f9b8c-abcde', addr: '10.244.1.10', netns: 4026532001 },
	{ namespace: 'default', pod: 'checkout-6f9b8c-fghij', addr: '10.244.1.11', netns: 4026532002 },
	{ namespace: 'default', pod: 'cart-7d8f9-klmno', addr: '10.244.1.12', netns: 4026532003 },
	{ namespace: 'default', pod: 'cart-7d8f9-pqrst', addr: '10.244.1.13', netns: 4026532004 },
	{
		namespace: 'default',
		pod: 'frontend-5c7d6-uvwxy',
		addr: '10.244.1.14',
		addrV6: 'fd00::1:14',
		netns: 4026532005
	},
	{ namespace: 'default', pod: 'frontend-5c7d6-zabcd', addr: '10.244.1.15', netns: 4026532006 },
	{ namespace: 'default', pod: 'dns-map-probe', addr: '10.244.0.4', netns: 4026532856 },
	// kube-system (7)
	{
		namespace: 'kube-system',
		pod: 'coredns-66bc5c9577-hfk27',
		addr: '10.244.0.2',
		netns: 4026532701
	},
	{
		namespace: 'kube-system',
		pod: 'coredns-66bc5c9577-zx88q',
		addr: '10.244.0.9',
		netns: 4026532702
	},
	{ namespace: 'kube-system', pod: 'kube-proxy-4jz8n', addr: '10.244.0.11', netns: 4026532703 },
	{ namespace: 'kube-system', pod: 'kube-proxy-8xk2m', addr: '10.244.0.12', netns: 4026532704 },
	{
		namespace: 'kube-system',
		pod: 'metrics-server-7f6b9-abc12',
		addr: '10.244.0.13',
		netns: 4026532705
	},
	{
		namespace: 'kube-system',
		pod: 'local-path-provisioner-9c8d',
		addr: '10.244.0.14',
		netns: 4026532706
	},
	{ namespace: 'kube-system', pod: 'node-local-dns-99xyz', addr: '10.244.0.15', netns: 4026532707 },
	// monitoring (6)
	{ namespace: 'monitoring', pod: 'prometheus-server-0', addr: '10.244.2.20', netns: 4026532801 },
	{ namespace: 'monitoring', pod: 'grafana-6d8f9c-def34', addr: '10.244.2.21', netns: 4026532802 },
	{ namespace: 'monitoring', pod: 'alertmanager-0', addr: '10.244.2.22', netns: 4026532803 },
	{ namespace: 'monitoring', pod: 'node-exporter-7f2q1', addr: '10.244.2.23', netns: 4026532804 },
	{ namespace: 'monitoring', pod: 'node-exporter-9k3r5', addr: '10.244.2.24', netns: 4026532805 },
	{
		namespace: 'monitoring',
		pod: 'kube-state-metrics-5b7c8',
		addr: '10.244.2.25',
		netns: 4026532806
	}
];

const NODE = 'minikube';

/** A request+response pair captured client-side only (most common/simple case). */
function simpleTransaction(
	events: Record<string, unknown>[],
	pod: FixturePod,
	opts: {
		id: string;
		tsMs: number;
		name?: string;
		resolver?: { addr: string; port: number };
		dstK8s?: K8sRefOpts;
		rcode?: string;
		latencyNsRaw?: number;
		qtypeRaw?: number;
		srcAddr?: string;
		srcPort?: number;
		proto?: string;
		numAnswers?: number;
		addresses?: string;
		responseDelayMs?: number;
	}
): void {
	const resolver = opts.resolver ?? RESOLVER_KUBE_DNS;
	const srcAddr = opts.srcAddr ?? pod.addr;
	const srcPort = opts.srcPort ?? 40000 + (opts.id.charCodeAt(0) % 5000);
	const common = {
		k8s: {
			node: pod.node ?? NODE,
			namespace: pod.namespace,
			podName: pod.pod,
			containerName: pod.pod
		},
		runtime: {
			containerId: `${pod.pod}-container-id`,
			containerName: '',
			runtimeName: 'containerd'
		},
		netnsId: pod.netns
	};
	events.push(
		rawEvent({
			isResponse: false,
			tsMs: opts.tsMs,
			id: opts.id,
			name: opts.name,
			qtypeRaw: opts.qtypeRaw,
			srcAddr,
			srcPort,
			dstAddr: resolver.addr,
			dstPort: resolver.port,
			proto: opts.proto,
			dstK8s: opts.dstK8s,
			...common
		})
	);
	events.push(
		rawEvent({
			isResponse: true,
			tsMs: opts.tsMs + (opts.responseDelayMs ?? 3),
			id: opts.id,
			name: opts.name,
			qtypeRaw: opts.qtypeRaw,
			srcAddr: resolver.addr,
			srcPort: resolver.port,
			dstAddr: srcAddr,
			dstPort: srcPort,
			proto: opts.proto,
			rcode: opts.rcode ?? 'Success',
			latencyNsRaw: opts.latencyNsRaw,
			numAnswers: opts.numAnswers,
			addresses: opts.addresses,
			...common
		})
	);
}

/**
 * Build the full rich fixture: raw trace_dns events covering 20 pods across
 * 3 namespaces, several resolvers, and every DNS-map edge case called out
 * in the review (duplicates, NXDOMAIN search-suffix expansion, server
 * errors, retries/timeouts, late/slow responses, orphans, mDNS, multi-
 * protocol/dual-stack/sidecar aggregation, authoritative resolver
 * enrichment, Docker-only and netns-only fallback identity).
 */
export function buildRichDnsFixture(): Record<string, unknown>[] {
	resetFixtureMsgId();
	const events: Record<string, unknown>[] = [];
	const byPod = (pod: string): FixturePod => {
		const found = FIXTURE_PODS.find((p) => p.pod === pod);
		if (!found) throw new Error(`unknown fixture pod: ${pod}`);
		return found;
	};

	let t = 0;
	const step = () => (t += 200);

	// 1) Baseline: every pod gets one healthy A-record lookup against
	// kube-dns, with authoritative svc enrichment on the request's dst.k8s -
	// this alone covers 20 pods / 3 namespaces for grouping+scale tests.
	for (const pod of FIXTURE_PODS) {
		simpleTransaction(events, pod, {
			id: `base-${pod.pod}`,
			tsMs: step(),
			name: `kubernetes.default.svc.cluster.local.`,
			dstK8s: { kind: 'svc', name: 'kube-dns', namespace: 'kube-system' },
			addresses: '10.96.0.1'
		});
	}

	// 2) Client + CoreDNS-side duplicate observations (mirrors the real
	// minikube capture: the same logical query is independently captured at
	// the client and at the resolver). Intentionally NOT deduplicated.
	{
		const probe = byPod('dns-map-probe');
		const coredns = byPod('coredns-66bc5c9577-hfk27');
		const id = 'dup-0001';
		const name = 'kubernetes.default.svc.cluster.local.';
		const tsBase = step();
		// Client-side: request OUTGOING + response HOST.
		events.push(
			rawEvent({
				isResponse: false,
				tsMs: tsBase,
				id,
				name,
				srcAddr: probe.addr,
				srcPort: 56224,
				dstAddr: RESOLVER_KUBE_DNS.addr,
				dstPort: 53,
				pktTypeRaw: 4,
				dstK8s: { kind: 'svc', name: 'kube-dns', namespace: 'kube-system' },
				k8s: {
					node: NODE,
					namespace: probe.namespace,
					podName: probe.pod,
					containerName: probe.pod
				},
				runtime: {
					containerId: 'probe-container-id',
					containerName: '',
					runtimeName: 'containerd'
				},
				netnsId: probe.netns
			})
		);
		// Resolver-side: same logical request, captured arriving at CoreDNS.
		events.push(
			rawEvent({
				isResponse: false,
				tsMs: tsBase + 1,
				id,
				name,
				srcAddr: probe.addr,
				srcPort: 56224,
				dstAddr: coredns.addr,
				dstPort: 53,
				pktTypeRaw: 0,
				dstK8s: { kind: 'pod', name: coredns.pod, namespace: 'kube-system' },
				k8s: {
					node: NODE,
					namespace: coredns.namespace,
					podName: coredns.pod,
					containerName: 'coredns'
				},
				runtime: {
					containerId: 'coredns-container-id',
					containerName: 'coredns',
					runtimeName: 'unknown'
				},
				netnsId: coredns.netns
			})
		);
		// Resolver-side response, captured leaving CoreDNS.
		events.push(
			rawEvent({
				isResponse: true,
				tsMs: tsBase + 3,
				id,
				name,
				srcAddr: coredns.addr,
				srcPort: 53,
				dstAddr: probe.addr,
				dstPort: 56224,
				pktTypeRaw: 4,
				rcode: 'Success',
				k8s: {
					node: NODE,
					namespace: coredns.namespace,
					podName: coredns.pod,
					containerName: 'coredns'
				},
				runtime: {
					containerId: 'coredns-container-id',
					containerName: 'coredns',
					runtimeName: 'unknown'
				},
				netnsId: coredns.netns
			})
		);
		// Client-side response, captured arriving at the probe.
		events.push(
			rawEvent({
				isResponse: true,
				tsMs: tsBase + 4,
				id,
				name,
				srcAddr: RESOLVER_KUBE_DNS.addr,
				srcPort: 53,
				dstAddr: probe.addr,
				dstPort: 56224,
				pktTypeRaw: 0,
				rcode: 'Success',
				k8s: {
					node: NODE,
					namespace: probe.namespace,
					podName: probe.pod,
					containerName: probe.pod
				},
				runtime: {
					containerId: 'probe-container-id',
					containerName: '',
					runtimeName: 'containerd'
				},
				netnsId: probe.netns
			})
		);
	}

	// 3) NXDOMAIN search-suffix expansion: resolv.conf ndots search list
	// tried in order, each intermediate suffix returns NameError, the final
	// absolute name succeeds.
	{
		const pod = byPod('checkout-6f9b8c-abcde');
		const suffixes = [
			'redis.default.svc.cluster.local.',
			'redis.svc.cluster.local.',
			'redis.cluster.local.',
			'redis.'
		];
		suffixes.forEach((name, i) => {
			simpleTransaction(events, pod, {
				id: `search-${i}`,
				tsMs: step(),
				name,
				rcode: i === suffixes.length - 1 ? 'Success' : 'NameError',
				numAnswers: i === suffixes.length - 1 ? 1 : 0,
				addresses: i === suffixes.length - 1 ? '203.0.113.5' : ''
			});
		});
	}

	// 4) Pure NXDOMAIN (no retries/search expansion) against CoreDNS pod B.
	simpleTransaction(events, byPod('cart-7d8f9-klmno'), {
		id: 'nxdomain-standalone',
		tsMs: step(),
		name: 'definitely-missing.default.svc.cluster.local.',
		resolver: RESOLVER_COREDNS_POD_B,
		dstK8s: { kind: 'pod', name: 'coredns-66bc5c9577-zx88q', namespace: 'kube-system' },
		rcode: 'NameError',
		numAnswers: 0
	});

	// 5) ServerFailure.
	simpleTransaction(events, byPod('cart-7d8f9-pqrst'), {
		id: 'servfail-1',
		tsMs: step(),
		name: 'flaky-upstream.example.com.',
		resolver: RESOLVER_EXTERNAL,
		rcode: 'ServerFailure',
		numAnswers: 0
	});

	// 6) Refused.
	simpleTransaction(events, byPod('frontend-5c7d6-zabcd'), {
		id: 'refused-1',
		tsMs: step(),
		name: 'internal-only.corp.example.',
		resolver: RESOLVER_EXTERNAL,
		rcode: 'Refused',
		numAnswers: 0
	});

	// 7) Retries then a final timeout (no response ever arrives).
	{
		const pod = byPod('metrics-server-7f6b9-abc12');
		const id = 'timeout-1';
		const name = 'unreachable-backend.monitoring.svc.cluster.local.';
		const srcPort = 45111;
		const common = {
			k8s: { node: NODE, namespace: pod.namespace, podName: pod.pod, containerName: pod.pod },
			runtime: { containerId: `${pod.pod}-cid`, containerName: '', runtimeName: 'containerd' },
			netnsId: pod.netns
		};
		const base = step();
		for (let attempt = 0; attempt < 3; attempt++) {
			events.push(
				rawEvent({
					isResponse: false,
					tsMs: base + attempt * 1000,
					id,
					name,
					srcAddr: pod.addr,
					srcPort,
					dstAddr: RESOLVER_KUBE_DNS.addr,
					dstPort: 53,
					...common
				})
			);
		}
		// No matching response event is ever added - this transaction only
		// finalizes as `no-response` once `computeDnsCorrelation` is called
		// with `now` past its deadline (exercised in the test, not baked in
		// here).
	}

	// 8) Late response: reply arrives after the response deadline would
	// already have elapsed for a short timeout, so it must surface as
	// `late-response` rather than silently vanishing.
	simpleTransaction(events, byPod('kube-proxy-4jz8n'), {
		id: 'late-1',
		tsMs: step(),
		name: 'slow-control-plane.kube-system.svc.cluster.local.',
		responseDelayMs: 6000
	});

	// 9) Slow (but on-time) response - well under the timeout, but latency
	// high enough to cross the slow threshold (timeoutMs/10).
	simpleTransaction(events, byPod('kube-proxy-8xk2m'), {
		id: 'slow-1',
		tsMs: step(),
		name: 'overloaded-service.default.svc.cluster.local.',
		latencyNsRaw: 900_000_000 // 900ms
	});

	// 10) Orphan response: a response with no corresponding pending request
	// in the retained window (e.g. the request rotated out of the ring
	// buffer).
	events.push(
		rawEvent({
			isResponse: true,
			tsMs: step(),
			id: 'orphan-1',
			name: 'late-arrival.default.svc.cluster.local.',
			srcAddr: RESOLVER_KUBE_DNS.addr,
			srcPort: 53,
			dstAddr: byPod('local-path-provisioner-9c8d').addr,
			dstPort: 51000,
			rcode: 'Success',
			k8s: {
				node: NODE,
				namespace: 'default',
				podName: '',
				containerName: ''
			},
			netnsId: byPod('local-path-provisioner-9c8d').netns
		})
	);

	// 11) mDNS/ambiguous multicast traffic (never one-to-one correlated).
	events.push(
		rawEvent({
			isResponse: false,
			tsMs: step(),
			id: '0',
			name: '_services._dns-sd._udp.local.',
			srcAddr: byPod('node-local-dns-99xyz').addr,
			srcPort: 5353,
			dstAddr: '224.0.0.251',
			dstPort: 5353,
			pktTypeRaw: 4,
			k8s: {
				node: NODE,
				namespace: 'kube-system',
				podName: 'node-local-dns-99xyz',
				containerName: 'node-local-dns-99xyz'
			},
			netnsId: byPod('node-local-dns-99xyz').netns
		})
	);

	// 12) UDP + TCP from the same pod (truncated UDP response retried over
	// TCP) must still aggregate into a single workload.
	{
		const pod = byPod('frontend-5c7d6-uvwxy');
		simpleTransaction(events, pod, {
			id: 'proto-udp',
			tsMs: step(),
			name: 'large-txt-record.default.svc.cluster.local.',
			proto: 'UDP'
		});
		simpleTransaction(events, pod, {
			id: 'proto-tcp',
			tsMs: step(),
			name: 'large-txt-record.default.svc.cluster.local.',
			proto: 'TCP',
			srcPort: 51500
		});
	}

	// 13) Sidecar: same pod, different container name issuing its own query
	// - still the same workload (container is not part of the workload key).
	{
		const pod = byPod('frontend-5c7d6-uvwxy');
		const common = {
			k8s: {
				node: NODE,
				namespace: pod.namespace,
				podName: pod.pod,
				containerName: 'envoy-sidecar'
			},
			runtime: {
				containerId: 'envoy-sidecar-cid',
				containerName: 'envoy-sidecar',
				runtimeName: 'containerd'
			},
			netnsId: pod.netns
		};
		const id = 'sidecar-1';
		const name = 'sidecar-upstream.default.svc.cluster.local.';
		const tsA = step();
		events.push(
			rawEvent({
				isResponse: false,
				tsMs: tsA,
				id,
				name,
				srcAddr: pod.addr,
				srcPort: 52000,
				dstAddr: RESOLVER_KUBE_DNS.addr,
				dstPort: 53,
				...common
			})
		);
		events.push(
			rawEvent({
				isResponse: true,
				tsMs: tsA + 2,
				id,
				name,
				srcAddr: RESOLVER_KUBE_DNS.addr,
				srcPort: 53,
				dstAddr: pod.addr,
				dstPort: 52000,
				rcode: 'Success',
				...common
			})
		);
	}

	// 14) v4/v6 dual-stack from the same pod - both addresses must
	// aggregate into the one workload (namespace+pod key wins over address).
	{
		const pod = byPod('frontend-5c7d6-uvwxy');
		if (pod.addrV6) {
			simpleTransaction(events, pod, {
				id: 'v6-1',
				tsMs: step(),
				name: 'ipv6-only-service.default.svc.cluster.local.',
				qtypeRaw: 28,
				srcAddr: pod.addrV6,
				srcPort: 53100
			});
		}
	}

	// 15) Docker-only capture: k8s fields are *present but empty* (not
	// absent) - must not create an empty-string namespace/pod group, and
	// must fall back to the runtime container identity tier.
	{
		const id = 'docker-only-1';
		const name = 'registry.docker-internal.local.';
		const tsBase = step();
		const dockerAddr = '172.17.0.5';
		events.push(
			rawEvent({
				isResponse: false,
				tsMs: tsBase,
				id,
				name,
				srcAddr: dockerAddr,
				srcPort: 48000,
				dstAddr: '172.17.0.1',
				dstPort: 53,
				k8s: { node: '', namespace: '', podName: '', containerName: '' },
				runtime: {
					containerId: 'a1b2c3d4e5f6docker',
					containerName: 'my-app',
					runtimeName: 'docker'
				},
				netnsId: 4026533900
			})
		);
		events.push(
			rawEvent({
				isResponse: true,
				tsMs: tsBase + 4,
				id,
				name,
				srcAddr: '172.17.0.1',
				srcPort: 53,
				dstAddr: dockerAddr,
				dstPort: 48000,
				rcode: 'Success',
				k8s: { node: '', namespace: '', podName: '', containerName: '' },
				runtime: {
					containerId: 'a1b2c3d4e5f6docker',
					containerName: 'my-app',
					runtimeName: 'docker'
				},
				netnsId: 4026533900
			})
		);
	}

	// 16) Netns-only fallback: no k8s fields at all, no runtime container
	// id/name either - two distinct bare-netns "workloads" must not
	// collapse into one.
	for (const [suffix, netnsId] of [
		['a', 4026534001],
		['b', 4026534002]
	] as const) {
		const addr = `192.168.100.${suffix === 'a' ? 10 : 11}`;
		const id = `netns-only-${suffix}`;
		const name = 'bare-process-lookup.internal.';
		const tsBase = step();
		events.push(
			rawEvent({
				isResponse: false,
				tsMs: tsBase,
				id,
				name,
				srcAddr: addr,
				srcPort: 39000,
				dstAddr: RESOLVER_NODE_LOCAL.addr,
				dstPort: 53,
				netnsId
			})
		);
		events.push(
			rawEvent({
				isResponse: true,
				tsMs: tsBase + 2,
				id,
				name,
				srcAddr: RESOLVER_NODE_LOCAL.addr,
				srcPort: 53,
				dstAddr: addr,
				dstPort: 39000,
				rcode: 'Success',
				netnsId
			})
		);
	}

	// 17) A second CoreDNS replica resolving lookups for a monitoring pod,
	// to give the map more than one resolver among the "many pods" set and
	// exercise authoritative resolver enrichment on a second replica.
	simpleTransaction(events, byPod('prometheus-server-0'), {
		id: 'replica-b-1',
		tsMs: step(),
		name: 'alertmanager-operated.monitoring.svc.cluster.local.',
		resolver: RESOLVER_COREDNS_POD_B,
		dstK8s: { kind: 'pod', name: 'coredns-66bc5c9577-zx88q', namespace: 'kube-system' }
	});

	return events;
}

/**
 * A smaller, human-readable subset of the same edge cases, used for the
 * Playwright visual harness (see scripts/generate-demo-dns-recent.ts).
 * `buildRichDnsFixture` above (20 pods / 3 namespaces) is intentionally
 * large for scale/grouping/non-overlap assertions in dnsMapGraph.test.ts;
 * a screenshot built from that many nodes is unreadably zoomed out at a
 * fixed viewport size. This variant keeps roughly a dozen workloads across
 * all 3 namespaces plus the non-Kubernetes fallback group, ~4 resolvers,
 * and one representative example of each documented severity case (healthy,
 * NXDOMAIN, server failure, timeout/retry, late/slow warning) so the
 * screenshots stay legible while still demonstrating real topology and
 * triage value.
 */
export function buildRepresentativeDnsFixture(): Record<string, unknown>[] {
	resetFixtureMsgId();
	const events: Record<string, unknown>[] = [];

	const pods: Record<string, FixturePod> = {
		checkout: {
			namespace: 'default',
			pod: 'checkout-6f9b8c-abcde',
			addr: '10.244.1.10',
			netns: 4026532001
		},
		cart: { namespace: 'default', pod: 'cart-7d8f9-pqrst', addr: '10.244.1.13', netns: 4026532004 },
		frontend: {
			namespace: 'default',
			pod: 'frontend-5c7d6-uvwxy',
			addr: '10.244.1.14',
			netns: 4026532005
		},
		probe: { namespace: 'default', pod: 'dns-map-probe', addr: '10.244.0.4', netns: 4026532856 },
		coredns: {
			namespace: 'kube-system',
			pod: 'coredns-66bc5c9577-hfk27',
			addr: '10.244.0.2',
			netns: 4026532701
		},
		kubeProxyA: {
			namespace: 'kube-system',
			pod: 'kube-proxy-4jz8n',
			addr: '10.244.0.11',
			netns: 4026532703
		},
		kubeProxyB: {
			namespace: 'kube-system',
			pod: 'kube-proxy-8xk2m',
			addr: '10.244.0.12',
			netns: 4026532704
		},
		metricsServer: {
			namespace: 'kube-system',
			pod: 'metrics-server-7f6b9-abc12',
			addr: '10.244.0.13',
			netns: 4026532705
		},
		prometheus: {
			namespace: 'monitoring',
			pod: 'prometheus-server-0',
			addr: '10.244.2.20',
			netns: 4026532801
		},
		nodeExporter: {
			namespace: 'monitoring',
			pod: 'node-exporter-7f2q1',
			addr: '10.244.2.23',
			netns: 4026532804
		}
	};

	let t = 0;
	const step = () => (t += 200);

	// default (4 workloads)
	// 1) NXDOMAIN search-suffix expansion, ending in success.
	{
		const suffixes = [
			'redis.default.svc.cluster.local.',
			'redis.svc.cluster.local.',
			'redis.cluster.local.',
			'redis.'
		];
		suffixes.forEach((name, i) => {
			simpleTransaction(events, pods.checkout, {
				id: `search-${i}`,
				tsMs: step(),
				name,
				rcode: i === suffixes.length - 1 ? 'Success' : 'NameError',
				numAnswers: i === suffixes.length - 1 ? 1 : 0,
				addresses: i === suffixes.length - 1 ? '203.0.113.5' : ''
			});
		});
	}
	// 2) ServerFailure against an external resolver.
	simpleTransaction(events, pods.cart, {
		id: 'servfail-1',
		tsMs: step(),
		name: 'flaky-upstream.example.com.',
		resolver: RESOLVER_EXTERNAL,
		rcode: 'ServerFailure',
		numAnswers: 0
	});
	// 3) Healthy baseline.
	simpleTransaction(events, pods.frontend, {
		id: 'healthy-frontend',
		tsMs: step(),
		name: 'kubernetes.default.svc.cluster.local.',
		dstK8s: { kind: 'svc', name: 'kube-dns', namespace: 'kube-system' },
		addresses: '10.96.0.1'
	});
	// 4) Client + CoreDNS-side duplicate observations of the same query -
	// intentionally NOT deduplicated (see docs/DNS_MAP.md).
	{
		const id = 'dup-0001';
		const name = 'kubernetes.default.svc.cluster.local.';
		const tsBase = step();
		const common = { node: NODE };
		events.push(
			rawEvent({
				isResponse: false,
				tsMs: tsBase,
				id,
				name,
				srcAddr: pods.probe.addr,
				srcPort: 56224,
				dstAddr: RESOLVER_KUBE_DNS.addr,
				dstPort: 53,
				pktTypeRaw: 4,
				dstK8s: { kind: 'svc', name: 'kube-dns', namespace: 'kube-system' },
				k8s: {
					...common,
					namespace: pods.probe.namespace,
					podName: pods.probe.pod,
					containerName: pods.probe.pod
				},
				netnsId: pods.probe.netns
			})
		);
		events.push(
			rawEvent({
				isResponse: false,
				tsMs: tsBase + 1,
				id,
				name,
				srcAddr: pods.probe.addr,
				srcPort: 56224,
				dstAddr: pods.coredns.addr,
				dstPort: 53,
				pktTypeRaw: 0,
				dstK8s: { kind: 'pod', name: pods.coredns.pod, namespace: 'kube-system' },
				k8s: {
					...common,
					namespace: pods.coredns.namespace,
					podName: pods.coredns.pod,
					containerName: 'coredns'
				},
				netnsId: pods.coredns.netns
			})
		);
		events.push(
			rawEvent({
				isResponse: true,
				tsMs: tsBase + 3,
				id,
				name,
				srcAddr: pods.coredns.addr,
				srcPort: 53,
				dstAddr: pods.probe.addr,
				dstPort: 56224,
				pktTypeRaw: 4,
				rcode: 'Success',
				k8s: {
					...common,
					namespace: pods.coredns.namespace,
					podName: pods.coredns.pod,
					containerName: 'coredns'
				},
				netnsId: pods.coredns.netns
			})
		);
		events.push(
			rawEvent({
				isResponse: true,
				tsMs: tsBase + 4,
				id,
				name,
				srcAddr: RESOLVER_KUBE_DNS.addr,
				srcPort: 53,
				dstAddr: pods.probe.addr,
				dstPort: 56224,
				pktTypeRaw: 0,
				rcode: 'Success',
				k8s: {
					...common,
					namespace: pods.probe.namespace,
					podName: pods.probe.pod,
					containerName: pods.probe.pod
				},
				netnsId: pods.probe.netns
			})
		);
	}

	// kube-system (4 workloads)
	// 5) CoreDNS's own healthy baseline query (it's a workload too, not just a resolver).
	simpleTransaction(events, pods.coredns, {
		id: 'healthy-coredns',
		tsMs: step(),
		name: 'kubernetes.default.svc.cluster.local.',
		dstK8s: { kind: 'svc', name: 'kube-dns', namespace: 'kube-system' },
		addresses: '10.96.0.1'
	});
	// 6) Late response (warning): reply arrives after the deadline.
	simpleTransaction(events, pods.kubeProxyA, {
		id: 'late-1',
		tsMs: step(),
		name: 'slow-control-plane.kube-system.svc.cluster.local.',
		responseDelayMs: 6000
	});
	// 7) Slow (on-time, but crosses the slow threshold) response (warning).
	simpleTransaction(events, pods.kubeProxyB, {
		id: 'slow-1',
		tsMs: step(),
		name: 'overloaded-service.default.svc.cluster.local.',
		latencyNsRaw: 900_000_000 // 900ms
	});
	// 8) Retries then a timeout (error) - no response ever arrives.
	{
		const name = 'unreachable-backend.monitoring.svc.cluster.local.';
		const srcPort = 45111;
		const common = {
			k8s: {
				node: NODE,
				namespace: pods.metricsServer.namespace,
				podName: pods.metricsServer.pod,
				containerName: pods.metricsServer.pod
			},
			runtime: {
				containerId: `${pods.metricsServer.pod}-cid`,
				containerName: '',
				runtimeName: 'containerd'
			},
			netnsId: pods.metricsServer.netns
		};
		const base = step();
		for (let attempt = 0; attempt < 3; attempt++) {
			events.push(
				rawEvent({
					isResponse: false,
					tsMs: base + attempt * 1000,
					id: 'timeout-1',
					name,
					srcAddr: pods.metricsServer.addr,
					srcPort,
					dstAddr: RESOLVER_KUBE_DNS.addr,
					dstPort: 53,
					...common
				})
			);
		}
	}

	// monitoring (2 workloads, both healthy)
	simpleTransaction(events, pods.prometheus, {
		id: 'healthy-prometheus',
		tsMs: step(),
		name: 'kubernetes.default.svc.cluster.local.',
		dstK8s: { kind: 'svc', name: 'kube-dns', namespace: 'kube-system' },
		addresses: '10.96.0.1'
	});
	simpleTransaction(events, pods.nodeExporter, {
		id: 'healthy-node-exporter',
		tsMs: step(),
		name: 'kubernetes.default.svc.cluster.local.',
		dstK8s: { kind: 'svc', name: 'kube-dns', namespace: 'kube-system' },
		addresses: '10.96.0.1'
	});

	// non-Kubernetes fallback group (2 workloads)
	// 9) Docker-only capture: k8s fields present but empty - falls back to
	// the runtime container identity tier, routed through the node-local
	// resolver so the representative set stays at ~4 resolvers total.
	{
		const id = 'docker-only-1';
		const name = 'registry.docker-internal.local.';
		const tsBase = step();
		const dockerAddr = '172.17.0.5';
		const common = {
			k8s: { node: '', namespace: '', podName: '', containerName: '' },
			runtime: {
				containerId: 'a1b2c3d4e5f6docker',
				containerName: 'my-app',
				runtimeName: 'docker'
			},
			netnsId: 4026533900
		};
		events.push(
			rawEvent({
				isResponse: false,
				tsMs: tsBase,
				id,
				name,
				srcAddr: dockerAddr,
				srcPort: 48000,
				dstAddr: RESOLVER_NODE_LOCAL.addr,
				dstPort: 53,
				...common
			})
		);
		events.push(
			rawEvent({
				isResponse: true,
				tsMs: tsBase + 4,
				id,
				name,
				srcAddr: RESOLVER_NODE_LOCAL.addr,
				srcPort: 53,
				dstAddr: dockerAddr,
				dstPort: 48000,
				rcode: 'Success',
				...common
			})
		);
	}
	// 10) Netns-only fallback: no k8s/runtime identity at all.
	{
		const id = 'netns-only-a';
		const name = 'bare-process-lookup.internal.';
		const addr = '192.168.100.10';
		const tsBase = step();
		events.push(
			rawEvent({
				isResponse: false,
				tsMs: tsBase,
				id,
				name,
				srcAddr: addr,
				srcPort: 39000,
				dstAddr: RESOLVER_NODE_LOCAL.addr,
				dstPort: 53,
				netnsId: 4026534001
			})
		);
		events.push(
			rawEvent({
				isResponse: true,
				tsMs: tsBase + 2,
				id,
				name,
				srcAddr: RESOLVER_NODE_LOCAL.addr,
				srcPort: 53,
				dstAddr: addr,
				dstPort: 39000,
				rcode: 'Success',
				netnsId: 4026534001
			})
		);
	}

	return events;
}
