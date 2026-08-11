/**
 * Pure type definitions for DNS transaction correlation.
 *
 * Kept dependency-free (no `$lib` imports) so this module — and the
 * correlator that consumes it — can run directly under Node's built-in
 * test runner without a SvelteKit/bundler resolution step.
 */

/** A requester or nameserver network endpoint. */
export interface DnsEndpoint {
	addr: string;
	port: number;
}

/**
 * Lifecycle state of a correlated DNS transaction.
 *
 * - `answered`: a response matched a pending request before its deadline.
 * - `no-response`: no response was observed before the inactivity timeout.
 * - `late-response`: a response matched a request, but arrived after the
 *   request had already exceeded its deadline (would otherwise have been
 *   rendered as `no-response`).
 * - `orphan-response`: a response arrived with no matching pending request
 *   (e.g. the request fell outside the retained event window).
 * - `ambiguous`: mDNS/multicast-style traffic where one-to-one request/response
 *   matching is not valid (multiple responders, DNS id commonly 0). Rendered
 *   as standalone activity, never marked as answered/no-response.
 */
export type DnsTransactionState =
	| 'answered'
	| 'no-response'
	| 'late-response'
	| 'orphan-response'
	| 'ambiguous';

/**
 * Capture-side endpoint metadata for one side (requester or resolver) of a
 * transaction, as observed from whichever process/host actually captured
 * the packet. Only ever populated for the side pkt_type attributes it to
 * (see `resolveCaptureOwner` in dnsCorrelator.ts) - the other side's
 * metadata is genuinely unknown for that observation, not merely absent.
 * All fields are normalized: empty strings become `undefined` so a missing
 * value can never be mistaken for an explicit empty group/label.
 */
export interface DnsCaptureMeta {
	node?: string;
	namespace?: string;
	podName?: string;
	containerName?: string;
	runtimeContainerId?: string;
	runtimeContainerName?: string;
	runtimeName?: string;
	/** Kernel network namespace id (present even for non-Kubernetes captures). */
	netnsId?: string;
}

/** Authoritative Kubernetes object reference enrichment (from src.k8s/dst.k8s), when known. */
export interface DnsK8sRef {
	kind: string;
	name: string;
	namespace?: string;
}

/** A single, finalized (renderable) DNS transaction row. */
export interface DnsTransaction {
	/** Stable identifier for keyed rendering (not a correlation key by itself). */
	id: string;
	/** Groups transactions by requester/nameserver address pair (ports excluded) for the network view. */
	peerKey: string;
	/** Capture identity (node/pod/container/etc.) + protocol, used to disambiguate identical DNS ids across peers. */
	identity: string;
	requester: DnsEndpoint;
	nameserver: DnsEndpoint;
	dnsId: string;
	/** Domain name as reported by the gadget (not normalized). */
	name: string;
	/** Human-readable query type if available, otherwise the raw numeric value as a string. */
	qtype: string;
	qtypeRaw?: number;
	state: DnsTransactionState;
	/** ms epoch of the first observed request (retries do not change this). */
	firstRequestTime?: number;
	/** ms epoch of the most recent request attempt. */
	latestAttemptTime?: number;
	/** ms epoch the response was observed, if any. */
	responseTime?: number;
	/** Number of request attempts observed for this transaction (>=1 unless orphan-response). */
	attemptCount: number;
	/** attemptCount - 1; number of retransmissions. */
	retryCount: number;
	/** Response latency in nanoseconds, preferring the gadget-provided value when non-zero. */
	latencyNs?: number;
	rcode?: string;
	rcodeRaw?: number;
	answers?: string;
	numAnswers?: number;
	/** Capture identity/runtime metadata for the requester side, when this observation captured it. */
	requesterMeta?: DnsCaptureMeta;
	/** Capture identity/runtime metadata for the resolver side, when this observation captured it. */
	resolverMeta?: DnsCaptureMeta;
	/** Authoritative k8s object enrichment for the requester endpoint (from src.k8s/dst.k8s), when known. */
	requesterK8s?: DnsK8sRef;
	/** Authoritative k8s object enrichment for the resolver endpoint (from src.k8s/dst.k8s), when known. */
	resolverK8s?: DnsK8sRef;
}

/** Field name mapping extracted from a trace_dns-compatible datasource. */
export interface DnsFieldConfig {
	idField: string;
	qrField: string;
	nameField: string;
	qtypeField: string;
	qtypeDisplayField?: string;
	srcAddrField: string;
	srcPortField?: string;
	dstAddrField: string;
	dstPortField?: string;
	protoField?: string;
	/** Preferred: a raw nanosecond-epoch timestamp field (e.g. `timestamp_raw`). */
	timestampField?: string;
	latencyField?: string;
	rcodeField?: string;
	rcodeDisplayField?: string;
	numAnswersField?: string;
	addressesField?: string;
	pktTypeField?: string;
	pktTypeDisplayField?: string;
	/** Fields used to build a capture identity key (node/namespace/pod/container/netns/...). */
	identityFields: string[];
	/** Individual capture identity/runtime field names (subset of identityFields), for structured metadata extraction. */
	k8sNodeField?: string;
	k8sNamespaceField?: string;
	k8sPodNameField?: string;
	k8sContainerNameField?: string;
	runtimeContainerIdField?: string;
	runtimeContainerNameField?: string;
	runtimeNameField?: string;
	netnsIdField?: string;
	/** Authoritative k8s object enrichment fields for the packet's src/dst endpoints. */
	srcK8sKindField?: string;
	srcK8sNameField?: string;
	srcK8sNamespaceField?: string;
	dstK8sKindField?: string;
	dstK8sNameField?: string;
	dstK8sNamespaceField?: string;
}

/** Options controlling correlation behavior. */
export interface DnsCorrelatorOptions {
	/** Inactivity timeout (ms) since the latest attempt before a pending query finalizes as `no-response`. */
	timeoutMs: number;
}

/** Default response timeout, matching common resolver per-attempt behavior (5s). */
export const DEFAULT_DNS_RESPONSE_TIMEOUT_MS = 5000;

/** Datasource annotation key used to override the response timeout. */
export const DNS_RESPONSE_TIMEOUT_ANNOTATION = 'view.dns.response-timeout';
/** Datasource annotation key used to enable the issues-only view initially. */
export const DNS_ISSUES_ONLY_ANNOTATION = 'view.dns.issues-only';
/** Datasource annotation key used to hide the namespace selector. */
export const DNS_NAMESPACE_SELECTOR_ANNOTATION = 'view.dns.namespace-selector';

/** Result of a single correlation pass over the currently retained events. */
export interface DnsCorrelationResult {
	/** Finalized transactions, newest first. */
	transactions: DnsTransaction[];
	/** Count of requests still awaiting a response (not yet past their deadline). */
	pendingCount: number;
	/** ms epoch of the soonest pending deadline, or null if nothing is pending. */
	nextDeadlineMs: number | null;
}
