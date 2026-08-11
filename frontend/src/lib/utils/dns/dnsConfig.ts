/**
 * DNS visualizer configuration: extracts field mappings and options from a
 * trace_dns-compatible datasource.
 */

import type { Datasource } from '../../types/charts.ts';
import { parseDurationMs } from '../chartConfig.ts';
import type { DnsFieldConfig } from './dnsTypes.ts';
import {
	DEFAULT_DNS_RESPONSE_TIMEOUT_MS,
	DNS_ISSUES_ONLY_ANNOTATION,
	DNS_NAMESPACE_SELECTOR_ANNOTATION,
	DNS_RESPONSE_TIMEOUT_ANNOTATION
} from './dnsTypes.ts';

/**
 * Mandatory field names that identify a trace-DNS-compatible datasource.
 * Matches both `hasField` conditions in the visualizer manifests and the
 * fields required to build a `DnsFieldConfig`.
 */
export const REQUIRED_DNS_FIELDS = ['id', 'qr_raw', 'name', 'qtype_raw', 'src.addr', 'dst.addr'];

/**
 * Candidate field name patterns used to build the capture identity key.
 * `netns_id` (the kernel network namespace inode/id) is included alongside
 * the k8s/runtime fields because those are absent for non-Kubernetes
 * captures (e.g. plain Docker/local containers), where two otherwise
 * identical-looking peers (same missing k8s fields, same requester port
 * reuse) can only be disambiguated by network namespace.
 */
const IDENTITY_FIELD_PATTERNS = [
	'k8s.node',
	'k8s.namespace',
	'k8s.podName',
	'k8s.containerName',
	'runtime.containerId',
	'runtime.containerName',
	'runtime.runtimeName',
	'netns_id'
];

/**
 * Extract DNS field configuration from a datasource. Returns null if the
 * datasource doesn't have the mandatory trace-DNS field signature.
 */
export function extractDnsConfig(ds: Datasource): DnsFieldConfig | null {
	const fieldNames = new Set(ds.fields.map((f) => f.fullName));
	const hasAll = REQUIRED_DNS_FIELDS.every((name) => fieldNames.has(name));
	if (!hasAll) return null;

	const has = (name: string): string | undefined => (fieldNames.has(name) ? name : undefined);

	const identityFields = IDENTITY_FIELD_PATTERNS.filter((name) => fieldNames.has(name));

	return {
		idField: 'id',
		qrField: 'qr_raw',
		nameField: 'name',
		qtypeField: 'qtype_raw',
		qtypeDisplayField: has('qtype'),
		srcAddrField: 'src.addr',
		srcPortField: has('src.port'),
		dstAddrField: 'dst.addr',
		dstPortField: has('dst.port'),
		protoField: has('src.proto') ?? has('proto'),
		timestampField: has('timestamp_raw') ?? has('timestamp'),
		latencyField: has('latency_ns_raw'),
		rcodeField: has('rcode_raw'),
		rcodeDisplayField: has('rcode'),
		numAnswersField: has('num_answers'),
		addressesField: has('addresses'),
		pktTypeField: has('pkt_type_raw'),
		pktTypeDisplayField: has('pkt_type'),
		identityFields,
		k8sNodeField: has('k8s.node'),
		k8sNamespaceField: has('k8s.namespace'),
		k8sPodNameField: has('k8s.podName'),
		k8sContainerNameField: has('k8s.containerName'),
		runtimeContainerIdField: has('runtime.containerId'),
		runtimeContainerNameField: has('runtime.containerName'),
		runtimeNameField: has('runtime.runtimeName'),
		netnsIdField: has('netns_id'),
		srcK8sKindField: has('src.k8s.kind'),
		srcK8sNameField: has('src.k8s.name'),
		srcK8sNamespaceField: has('src.k8s.namespace'),
		dstK8sKindField: has('dst.k8s.kind'),
		dstK8sNameField: has('dst.k8s.name'),
		dstK8sNamespaceField: has('dst.k8s.namespace')
	};
}

/**
 * Resolve the response timeout (ms) for a datasource, honoring the
 * `view.dns.response-timeout` annotation (Go-style duration string, e.g.
 * "5s"). Falls back to the 5s default when unset/invalid.
 */
export function extractDnsResponseTimeoutMs(ds: Datasource): number {
	const raw = ds.annotations?.[DNS_RESPONSE_TIMEOUT_ANNOTATION];
	const parsed = parseDurationMs(raw);
	return parsed > 0 ? parsed : DEFAULT_DNS_RESPONSE_TIMEOUT_MS;
}

export function extractDnsViewConfig(ds: Datasource) {
	return {
		issuesOnly: ds.annotations?.[DNS_ISSUES_ONLY_ANNOTATION] === 'true',
		namespaceSelector: ds.annotations?.[DNS_NAMESPACE_SELECTOR_ANNOTATION] !== 'false'
	};
}

export function showDnsNamespaceSelector(
	config: ReturnType<typeof extractDnsViewConfig>,
	namespaceCount: number
): boolean {
	return config.namespaceSelector && namespaceCount > 1;
}
