/**
 * Pure DNS transaction correlator.
 *
 * Recomputes the full set of correlated transactions from whatever raw
 * trace_dns events are currently retained (i.e. still present in the
 * bounded event ring buffer). There is no cross-call persisted state:
 * given the same events + `now`, the result is always the same. This
 * keeps the module trivially testable and avoids any unbounded
 * visualizer-local retention — everything is derived from, and therefore
 * bounded by, the underlying (already bounded) event buffer.
 *
 * Correlation key: capture identity (node/pod/container/...) + protocol +
 * requester addr/port + nameserver addr/port + DNS id + normalized name +
 * qtype_raw. DNS id alone is never sufficient (it collides across peers,
 * netns, and query names/types) and QCLASS is not available from the
 * gadget, so exact RFC 5452 matching is not possible — this is a documented
 * limitation, not a bug.
 */

import type {
	DnsCaptureMeta,
	DnsCorrelationResult,
	DnsCorrelatorOptions,
	DnsEndpoint,
	DnsFieldConfig,
	DnsK8sRef,
	DnsTransaction
} from './dnsTypes.ts';
import { DEFAULT_DNS_RESPONSE_TIMEOUT_MS } from './dnsTypes.ts';
import { primaryTime } from './dnsFormat.ts';

interface PendingDnsRequest {
	key: string;
	peerKey: string;
	identity: string;
	requester: DnsEndpoint;
	nameserver: DnsEndpoint;
	dnsId: string;
	name: string;
	qtype: string;
	qtypeRaw?: number;
	firstRequestTime?: number;
	latestAttemptTime?: number;
	attemptCount: number;
	/** ms epoch after which this pending request should finalize as no-response. */
	deadline?: number;
	requesterMeta?: DnsCaptureMeta;
	resolverMeta?: DnsCaptureMeta;
	requesterK8s?: DnsK8sRef;
	resolverK8s?: DnsK8sRef;
}

interface ParsedDnsEvent {
	isResponse: boolean;
	ambiguous: boolean;
	identity: string;
	/** Always normalized to requester -> nameserver, regardless of packet direction. */
	requester: DnsEndpoint;
	nameserver: DnsEndpoint;
	dnsId: string;
	name: string;
	normalizedName: string;
	qtype: string;
	qtypeRaw?: number;
	/** ms epoch, if resolvable. */
	timestamp?: number;
	latencyNsRaw?: number;
	rcode?: string;
	rcodeRaw?: number;
	answers?: string;
	numAnswers?: number;
	requesterMeta?: DnsCaptureMeta;
	resolverMeta?: DnsCaptureMeta;
	requesterK8s?: DnsK8sRef;
	resolverK8s?: DnsK8sRef;
}

/**
 * Interpret a `qr_raw` value defensively. It is documented as a numeric
 * 0/1 flag, but may arrive as a boolean depending on the transport/bridge.
 * Returns null when the value can't be classified so the event can be
 * skipped rather than mis-attributed.
 */
function interpretQr(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') {
		const v = value.trim().toLowerCase();
		if (v === 'true' || v === '1' || v === 'r') return true;
		if (v === 'false' || v === '0' || v === 'q') return false;
	}
	return null;
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}

function toStr(value: unknown): string {
	if (value === undefined || value === null) return '';
	return String(value);
}

/** Same as `toStr`, but normalizes empty strings to `undefined` (never an empty-but-present value). */
function toStrOrUndefined(value: unknown): string | undefined {
	const s = toStr(value).trim();
	return s === '' ? undefined : s;
}

function buildCaptureMeta(
	event: Record<string, unknown>,
	config: DnsFieldConfig
): DnsCaptureMeta | undefined {
	const meta: DnsCaptureMeta = {
		node: config.k8sNodeField ? toStrOrUndefined(event[config.k8sNodeField]) : undefined,
		namespace: config.k8sNamespaceField
			? toStrOrUndefined(event[config.k8sNamespaceField])
			: undefined,
		podName: config.k8sPodNameField ? toStrOrUndefined(event[config.k8sPodNameField]) : undefined,
		containerName: config.k8sContainerNameField
			? toStrOrUndefined(event[config.k8sContainerNameField])
			: undefined,
		runtimeContainerId: config.runtimeContainerIdField
			? toStrOrUndefined(event[config.runtimeContainerIdField])
			: undefined,
		runtimeContainerName: config.runtimeContainerNameField
			? toStrOrUndefined(event[config.runtimeContainerNameField])
			: undefined,
		runtimeName: config.runtimeNameField
			? toStrOrUndefined(event[config.runtimeNameField])
			: undefined,
		netnsId: config.netnsIdField ? toStrOrUndefined(event[config.netnsIdField]) : undefined
	};
	const hasAny = Object.values(meta).some((v) => v !== undefined);
	return hasAny ? meta : undefined;
}

/**
 * Extract an authoritative k8s object reference for one packet-direction
 * side (src or dst). Only considered "present" when `name` is non-empty -
 * the gadget reports `kind: "raw"` with an empty name for endpoints it
 * couldn't resolve to a k8s object, which must not be treated as a real
 * (if unusually-named) reference.
 */
function buildK8sRef(
	event: Record<string, unknown>,
	kindField?: string,
	nameField?: string,
	namespaceField?: string
): DnsK8sRef | undefined {
	if (!kindField || !nameField) return undefined;
	const name = toStrOrUndefined(event[nameField]);
	if (!name) return undefined;
	const kind = toStrOrUndefined(event[kindField]) ?? '';
	const namespace = namespaceField ? toStrOrUndefined(event[namespaceField]) : undefined;
	return { kind, name, namespace };
}

/**
 * Determine which side (requester or resolver) a capture-identity
 * observation (k8s dot-path/runtime dot-path/netns_id fields on the event) belongs to.
 *
 * `pkt_type` reflects which host actually captured the packet, not who
 * sent/received it logically: for a request, PACKET_OUTGOING(4) means it
 * was captured leaving the requester (so the event's own identity fields
 * describe the requester); anything else (typically HOST(0), i.e. captured
 * arriving at the destination host) means it was captured at the resolver.
 * For a response, HOST(0) means it was captured arriving at the requester;
 * anything else (typically OUTGOING(4), leaving the resolver) means it was
 * captured at the resolver. When `pkt_type` is unavailable at all, default
 * to attributing identity to the requester (documented best-effort default
 * — most non-Kubernetes/simple captures only observe the requester side).
 */
function resolveCaptureOwner(
	isResponse: boolean,
	pktTypeRaw: number | undefined
): 'requester' | 'resolver' {
	if (pktTypeRaw === undefined) return 'requester';
	if (isResponse) return pktTypeRaw === 0 ? 'requester' : 'resolver';
	return pktTypeRaw === 4 ? 'requester' : 'resolver';
}

/**
 * Resolve an event's wall-clock time in ms.
 *
 * `timestamp_raw` is treated as nanoseconds since the Unix epoch — IG's
 * timestamp enrichment normalizes kernel boot-time timestamps into
 * wall-clock epoch ns before export, so this is directly comparable across
 * capture points and to `Date.now()`. Falls back to `_receivedAt` (added
 * for array/batch datasources) when the raw timestamp is unavailable.
 *
 * Note: real epoch-ns values (~1.7e18) exceed Number.MAX_SAFE_INTEGER, so
 * sub-microsecond precision can be lost once divided into ms. This is fine
 * for our purposes (ordering, retry/timeout classification, and display),
 * which only need millisecond-ish resolution.
 */
function resolveEventTimeMs(
	event: Record<string, unknown>,
	config: DnsFieldConfig
): number | undefined {
	if (config.timestampField) {
		const raw = toNumber(event[config.timestampField]);
		if (raw !== undefined && raw > 0) return raw / 1e6;
	}
	const receivedAt = event['_receivedAt'];
	if (typeof receivedAt === 'number') return receivedAt;
	return undefined;
}

/** mDNS and LLMNR both use fixed well-known ports regardless of packet direction. */
const MULTICAST_DNS_PORTS = new Set([5353, 5355]);

/**
 * Detect an IPv4/IPv6 multicast or IPv4 broadcast address. Covers:
 * - IPv4 multicast: 224.0.0.0/4 (first octet 224-239)
 * - IPv4 limited broadcast: 255.255.255.255
 * - IPv6 multicast: ff00::/8 (first hex byte of the address is 0xff)
 */
function isMulticastOrBroadcastAddr(addr: string): boolean {
	if (!addr) return false;
	const a = addr.trim();
	if (a === '255.255.255.255') return true;

	const ipv4 = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(a);
	if (ipv4) {
		const firstOctet = Number(ipv4[1]);
		return firstOctet >= 224 && firstOctet <= 239;
	}

	// IPv6: strip zone id / brackets, then check the first hex group.
	const stripped = a
		.replace(/^\[|\]$/g, '')
		.split('%')[0]
		.toLowerCase();
	if (stripped.includes(':')) {
		const firstGroup = stripped.split(':')[0];
		return firstGroup.length >= 2 && firstGroup.slice(0, 2) === 'ff';
	}
	return false;
}

/**
 * Detect mDNS/LLMNR/multicast-style traffic where one-to-one request/response
 * correlation is not valid.
 *
 * The packet-type field (BROADCAST=1, MULTICAST=2 per trace_dns' pkt_type_raw)
 * only reflects *incoming* packet classification - locally-originated
 * multicast/broadcast queries are captured as PACKET_OUTGOING (4), so relying
 * on pkt_type_raw alone misses every outgoing mDNS/LLMNR query and would
 * otherwise time out as a false "no-response". Multicast/broadcast
 * destination (or source, for responses) address and the well-known mDNS
 * (5353) / LLMNR (5355) ports are direction-independent and therefore the
 * primary signal; pkt_type is still checked as a fast-path, and a DNS id of
 * 0 (common for mDNS) is a weaker fallback used only when nothing else
 * classified the packet.
 */
function isAmbiguousEvent(
	event: Record<string, unknown>,
	config: DnsFieldConfig,
	dnsId: string
): boolean {
	if (config.pktTypeField) {
		const n = toNumber(event[config.pktTypeField]);
		if (n === 1 || n === 2) return true;
	}
	if (config.pktTypeDisplayField) {
		const v = toStr(event[config.pktTypeDisplayField]).toUpperCase();
		if (v === 'BROADCAST' || v === 'MULTICAST') return true;
	}

	const srcAddr = toStr(event[config.srcAddrField]);
	const dstAddr = toStr(event[config.dstAddrField]);
	if (isMulticastOrBroadcastAddr(srcAddr) || isMulticastOrBroadcastAddr(dstAddr)) return true;

	const srcPort = config.srcPortField ? toNumber(event[config.srcPortField]) : undefined;
	const dstPort = config.dstPortField ? toNumber(event[config.dstPortField]) : undefined;
	if (
		(srcPort !== undefined && MULTICAST_DNS_PORTS.has(srcPort)) ||
		(dstPort !== undefined && MULTICAST_DNS_PORTS.has(dstPort))
	) {
		return true;
	}

	if (!config.pktTypeField && !config.pktTypeDisplayField) {
		if (dnsId === '0' || dnsId === '0x0000' || dnsId === '0000') return true;
	}
	return false;
}

function normalizeName(name: string): string {
	return name.trim().toLowerCase().replace(/\.$/, '');
}

function buildIdentity(event: Record<string, unknown>, config: DnsFieldConfig): string {
	const parts = config.identityFields.map((f) => toStr(event[f]));
	const proto = config.protoField ? toStr(event[config.protoField]) : '';
	parts.push(proto);
	return parts.join('|');
}

/** Parse and normalize a single raw event. Returns null if it's unusable (missing mandatory fields or unclassifiable qr). */
function parseDnsEvent(
	event: Record<string, unknown>,
	config: DnsFieldConfig
): ParsedDnsEvent | null {
	const isResponse = interpretQr(event[config.qrField]);
	if (isResponse === null) return null;

	const dnsId = toStr(event[config.idField]);
	const name = toStr(event[config.nameField]);
	if (!dnsId || !name) return null;

	const srcAddr = toStr(event[config.srcAddrField]);
	const dstAddr = toStr(event[config.dstAddrField]);
	if (!srcAddr || !dstAddr) return null;

	const srcPort = config.srcPortField ? (toNumber(event[config.srcPortField]) ?? 0) : 0;
	const dstPort = config.dstPortField ? (toNumber(event[config.dstPortField]) ?? 0) : 0;

	// Normalize to requester -> nameserver. Requests are already src=requester/dst=nameserver;
	// responses have src=nameserver/dst=requester, so reverse them.
	const requester: DnsEndpoint = isResponse
		? { addr: dstAddr, port: dstPort }
		: { addr: srcAddr, port: srcPort };
	const nameserver: DnsEndpoint = isResponse
		? { addr: srcAddr, port: srcPort }
		: { addr: dstAddr, port: dstPort };

	const qtypeRaw = toNumber(event[config.qtypeField]);
	const qtype = config.qtypeDisplayField
		? toStr(event[config.qtypeDisplayField]) || String(qtypeRaw ?? '')
		: String(qtypeRaw ?? '');

	const rcode = config.rcodeDisplayField
		? toStr(event[config.rcodeDisplayField]) || undefined
		: undefined;
	const rcodeRaw = config.rcodeField ? toNumber(event[config.rcodeField]) : undefined;
	const answers = config.addressesField
		? toStr(event[config.addressesField]) || undefined
		: undefined;
	const numAnswers = config.numAnswersField ? toNumber(event[config.numAnswersField]) : undefined;
	const latencyNsRaw = config.latencyField ? toNumber(event[config.latencyField]) : undefined;

	const pktTypeRaw = config.pktTypeField ? toNumber(event[config.pktTypeField]) : undefined;
	const captureOwner = resolveCaptureOwner(isResponse, pktTypeRaw);
	const captureMeta = buildCaptureMeta(event, config);
	const requesterMeta = captureOwner === 'requester' ? captureMeta : undefined;
	const resolverMeta = captureOwner === 'resolver' ? captureMeta : undefined;

	// Authoritative k8s enrichment is independent of which side captured the
	// packet: src.k8s/dst.k8s describe the packet's own src/dst endpoints,
	// which map directly to requester/nameserver once normalized for
	// direction (requests: src=requester,dst=nameserver; responses reversed).
	const srcK8s = buildK8sRef(
		event,
		config.srcK8sKindField,
		config.srcK8sNameField,
		config.srcK8sNamespaceField
	);
	const dstK8s = buildK8sRef(
		event,
		config.dstK8sKindField,
		config.dstK8sNameField,
		config.dstK8sNamespaceField
	);
	const requesterK8s = isResponse ? dstK8s : srcK8s;
	const resolverK8s = isResponse ? srcK8s : dstK8s;

	return {
		isResponse,
		ambiguous: isAmbiguousEvent(event, config, dnsId),
		identity: buildIdentity(event, config),
		requester,
		nameserver,
		dnsId,
		name,
		normalizedName: normalizeName(name),
		qtype,
		qtypeRaw,
		timestamp: resolveEventTimeMs(event, config),
		latencyNsRaw,
		rcode,
		rcodeRaw,
		answers,
		numAnswers,
		requesterMeta,
		resolverMeta,
		requesterK8s,
		resolverK8s
	};
}

function buildKey(
	parsed: Pick<
		ParsedDnsEvent,
		'identity' | 'requester' | 'nameserver' | 'dnsId' | 'normalizedName' | 'qtypeRaw'
	>
): string {
	return [
		parsed.identity,
		parsed.requester.addr,
		parsed.requester.port,
		parsed.nameserver.addr,
		parsed.nameserver.port,
		parsed.dnsId,
		parsed.normalizedName,
		parsed.qtypeRaw ?? ''
	].join('\u0001');
}

function buildPeerKey(identity: string, requester: DnsEndpoint, nameserver: DnsEndpoint): string {
	return [identity, requester.addr, nameserver.addr].join('\u0001');
}

/** Merge two capture-meta observations field-by-field, preferring `primary`'s defined values. */
function mergeCaptureMeta(
	primary: DnsCaptureMeta | undefined,
	secondary: DnsCaptureMeta | undefined
): DnsCaptureMeta | undefined {
	if (!primary) return secondary;
	if (!secondary) return primary;
	const merged: DnsCaptureMeta = {
		node: primary.node ?? secondary.node,
		namespace: primary.namespace ?? secondary.namespace,
		podName: primary.podName ?? secondary.podName,
		containerName: primary.containerName ?? secondary.containerName,
		runtimeContainerId: primary.runtimeContainerId ?? secondary.runtimeContainerId,
		runtimeContainerName: primary.runtimeContainerName ?? secondary.runtimeContainerName,
		runtimeName: primary.runtimeName ?? secondary.runtimeName,
		netnsId: primary.netnsId ?? secondary.netnsId
	};
	return merged;
}

function mergeK8sRef(
	primary: DnsK8sRef | undefined,
	secondary: DnsK8sRef | undefined
): DnsK8sRef | undefined {
	return primary ?? secondary;
}

/**
 * Deduplicate events by `msgID` (guards against the same source event being
 * processed twice, e.g. overlapping snapshots) and sort them chronologically.
 * Primary order is the resolved event time; ties (or events missing a
 * resolvable time) fall back to `msgID`, then original array position —
 * both of which approximate arrival order.
 */
function dedupeAndSort(
	events: Record<string, unknown>[],
	config: DnsFieldConfig
): Record<string, unknown>[] {
	const seen = new Set<number>();
	interface Item {
		event: Record<string, unknown>;
		ts: number;
		msgId: number;
		idx: number;
	}
	const items: Item[] = [];

	for (let idx = 0; idx < events.length; idx++) {
		const event = events[idx];
		const msgIdRaw = event['msgID'];
		const msgId = typeof msgIdRaw === 'number' ? msgIdRaw : NaN;
		if (Number.isFinite(msgId)) {
			if (seen.has(msgId)) continue;
			seen.add(msgId);
		}
		const ts = resolveEventTimeMs(event, config);
		items.push({
			event,
			ts: ts ?? NaN,
			msgId: Number.isFinite(msgId) ? msgId : idx,
			idx
		});
	}

	items.sort((a, b) => {
		if (Number.isFinite(a.ts) && Number.isFinite(b.ts) && a.ts !== b.ts) return a.ts - b.ts;
		if (a.msgId !== b.msgId) return a.msgId - b.msgId;
		return a.idx - b.idx;
	});

	return items.map((i) => i.event);
}

/**
 * Chronological ordering time for a transaction. Must match the "primary"
 * time shown in the Time column (`primaryTime` in dnsFormat.ts) - otherwise
 * "newest first" ordering and the displayed timestamps disagree, and the
 * network view's per-peer "latest N" slice (which relies on this same
 * global sort) would silently show a different set of transactions than the
 * ones a user would expect from what's displayed. Prefers the first request
 * time so retries/latency don't reorder a transaction's position.
 */
function sortTime(t: DnsTransaction): number {
	return primaryTime(t) ?? 0;
}

/**
 * Correlate the currently retained raw trace_dns events into transaction
 * rows. Pure function: no timers, no mutation of inputs, no persisted
 * state across calls — callers (e.g. a periodic timer, or a new event
 * batch) simply call this again with an updated `now`/`events`.
 */
export function computeDnsCorrelation(
	events: Record<string, unknown>[],
	config: DnsFieldConfig,
	now: number,
	options: DnsCorrelatorOptions = { timeoutMs: DEFAULT_DNS_RESPONSE_TIMEOUT_MS }
): DnsCorrelationResult {
	const timeoutMs = options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_DNS_RESPONSE_TIMEOUT_MS;
	const ordered = dedupeAndSort(events, config);

	const pending = new Map<string, PendingDnsRequest[]>();
	const transactions: DnsTransaction[] = [];

	for (const event of ordered) {
		const parsed = parseDnsEvent(event, config);
		if (!parsed) continue;

		if (parsed.ambiguous) {
			// mDNS/multicast: never claim one-to-one correlation. Each packet is
			// its own standalone activity entry.
			transactions.push({
				id: `ambiguous\u0001${buildKey(parsed)}\u0001${parsed.timestamp ?? 0}\u0001${transactions.length}`,
				peerKey: buildPeerKey(parsed.identity, parsed.requester, parsed.nameserver),
				identity: parsed.identity,
				requester: parsed.requester,
				nameserver: parsed.nameserver,
				dnsId: parsed.dnsId,
				name: parsed.name,
				qtype: parsed.qtype,
				qtypeRaw: parsed.qtypeRaw,
				state: 'ambiguous',
				firstRequestTime: parsed.isResponse ? undefined : parsed.timestamp,
				latestAttemptTime: parsed.isResponse ? undefined : parsed.timestamp,
				responseTime: parsed.isResponse ? parsed.timestamp : undefined,
				attemptCount: parsed.isResponse ? 0 : 1,
				retryCount: 0,
				latencyNs:
					parsed.latencyNsRaw && parsed.latencyNsRaw !== 0 ? parsed.latencyNsRaw : undefined,
				rcode: parsed.rcode,
				rcodeRaw: parsed.rcodeRaw,
				answers: parsed.answers,
				numAnswers: parsed.numAnswers,
				requesterMeta: parsed.requesterMeta,
				resolverMeta: parsed.resolverMeta,
				requesterK8s: parsed.requesterK8s,
				resolverK8s: parsed.resolverK8s
			});
			continue;
		}

		const key = buildKey(parsed);

		if (!parsed.isResponse) {
			const list = pending.get(key);
			if (list && list.length > 0) {
				// Repeated request before a response: retransmission of the oldest
				// compatible pending candidate. Keep the first-request timestamp.
				const entry = list[0];
				entry.attemptCount++;
				entry.latestAttemptTime = parsed.timestamp;
				entry.deadline = parsed.timestamp !== undefined ? parsed.timestamp + timeoutMs : undefined;
				entry.requesterMeta = mergeCaptureMeta(entry.requesterMeta, parsed.requesterMeta);
				entry.resolverMeta = mergeCaptureMeta(entry.resolverMeta, parsed.resolverMeta);
				entry.requesterK8s = mergeK8sRef(entry.requesterK8s, parsed.requesterK8s);
				entry.resolverK8s = mergeK8sRef(entry.resolverK8s, parsed.resolverK8s);
			} else {
				const entry: PendingDnsRequest = {
					key,
					peerKey: buildPeerKey(parsed.identity, parsed.requester, parsed.nameserver),
					identity: parsed.identity,
					requester: parsed.requester,
					nameserver: parsed.nameserver,
					dnsId: parsed.dnsId,
					name: parsed.name,
					qtype: parsed.qtype,
					qtypeRaw: parsed.qtypeRaw,
					firstRequestTime: parsed.timestamp,
					latestAttemptTime: parsed.timestamp,
					attemptCount: 1,
					deadline: parsed.timestamp !== undefined ? parsed.timestamp + timeoutMs : undefined,
					requesterMeta: parsed.requesterMeta,
					resolverMeta: parsed.resolverMeta,
					requesterK8s: parsed.requesterK8s,
					resolverK8s: parsed.resolverK8s
				};
				pending.set(key, [entry]);
			}
			continue;
		}

		// Response: requester/nameserver are already normalized above.
		const list = pending.get(key);
		if (list && list.length > 0) {
			const entry = list.shift()!;
			if (list.length === 0) pending.delete(key);

			const late =
				entry.deadline !== undefined &&
				parsed.timestamp !== undefined &&
				parsed.timestamp > entry.deadline;

			const fallbackLatencyNs =
				entry.firstRequestTime !== undefined && parsed.timestamp !== undefined
					? (parsed.timestamp - entry.firstRequestTime) * 1e6
					: undefined;

			transactions.push({
				id: `${key}\u0001${entry.firstRequestTime ?? 0}`,
				peerKey: entry.peerKey,
				identity: entry.identity,
				requester: entry.requester,
				nameserver: entry.nameserver,
				dnsId: entry.dnsId,
				name: entry.name,
				qtype: entry.qtype,
				qtypeRaw: entry.qtypeRaw,
				state: late ? 'late-response' : 'answered',
				firstRequestTime: entry.firstRequestTime,
				latestAttemptTime: entry.latestAttemptTime,
				responseTime: parsed.timestamp,
				attemptCount: entry.attemptCount,
				retryCount: entry.attemptCount - 1,
				// Never infer success/failure from a zero latency_ns_raw — treat it as
				// "not provided" and fall back to our own request/response delta.
				latencyNs:
					parsed.latencyNsRaw && parsed.latencyNsRaw !== 0
						? parsed.latencyNsRaw
						: fallbackLatencyNs,
				rcode: parsed.rcode,
				rcodeRaw: parsed.rcodeRaw,
				answers: parsed.answers,
				numAnswers: parsed.numAnswers,
				requesterMeta: mergeCaptureMeta(entry.requesterMeta, parsed.requesterMeta),
				resolverMeta: mergeCaptureMeta(entry.resolverMeta, parsed.resolverMeta),
				requesterK8s: mergeK8sRef(entry.requesterK8s, parsed.requesterK8s),
				resolverK8s: mergeK8sRef(entry.resolverK8s, parsed.resolverK8s)
			});
		} else {
			transactions.push({
				id: `orphan\u0001${key}\u0001${parsed.timestamp ?? 0}`,
				peerKey: buildPeerKey(parsed.identity, parsed.requester, parsed.nameserver),
				identity: parsed.identity,
				requester: parsed.requester,
				nameserver: parsed.nameserver,
				dnsId: parsed.dnsId,
				name: parsed.name,
				qtype: parsed.qtype,
				qtypeRaw: parsed.qtypeRaw,
				state: 'orphan-response',
				responseTime: parsed.timestamp,
				attemptCount: 0,
				retryCount: 0,
				latencyNs:
					parsed.latencyNsRaw && parsed.latencyNsRaw !== 0 ? parsed.latencyNsRaw : undefined,
				rcode: parsed.rcode,
				rcodeRaw: parsed.rcodeRaw,
				answers: parsed.answers,
				numAnswers: parsed.numAnswers,
				requesterMeta: parsed.requesterMeta,
				resolverMeta: parsed.resolverMeta,
				requesterK8s: parsed.requesterK8s,
				resolverK8s: parsed.resolverK8s
			});
		}
	}

	// Sweep remaining pending requests: only past-deadline ones finalize as
	// no-response now. The rest stay pending (and are not rendered as rows)
	// until either a response arrives or a later sweep finds them expired.
	let pendingCount = 0;
	let nextDeadlineMs: number | null = null;

	for (const list of pending.values()) {
		for (const entry of list) {
			const expired = entry.deadline !== undefined && now >= entry.deadline;
			if (expired) {
				transactions.push({
					id: `timeout\u0001${entry.key}\u0001${entry.latestAttemptTime ?? 0}`,
					peerKey: entry.peerKey,
					identity: entry.identity,
					requester: entry.requester,
					nameserver: entry.nameserver,
					dnsId: entry.dnsId,
					name: entry.name,
					qtype: entry.qtype,
					qtypeRaw: entry.qtypeRaw,
					state: 'no-response',
					firstRequestTime: entry.firstRequestTime,
					latestAttemptTime: entry.latestAttemptTime,
					attemptCount: entry.attemptCount,
					retryCount: entry.attemptCount - 1,
					requesterMeta: entry.requesterMeta,
					resolverMeta: entry.resolverMeta,
					requesterK8s: entry.requesterK8s,
					resolverK8s: entry.resolverK8s
				});
			} else {
				pendingCount++;
				if (entry.deadline !== undefined) {
					if (nextDeadlineMs === null || entry.deadline < nextDeadlineMs) {
						nextDeadlineMs = entry.deadline;
					}
				}
			}
		}
	}

	transactions.sort((a, b) => sortTime(b) - sortTime(a));

	return { transactions, pendingCount, nextDeadlineMs };
}
