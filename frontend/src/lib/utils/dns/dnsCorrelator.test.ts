/**
 * Focused pure correlation checks for the DNS correlator.
 *
 * Run with: node --test frontend/src/lib/utils/dns/dnsCorrelator.test.ts
 * (Node's built-in test runner + native TypeScript type stripping — no
 * additional test dependency required.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDnsCorrelation } from './dnsCorrelator.ts';
import { primaryTime } from './dnsFormat.ts';
import type { DnsFieldConfig } from './dnsTypes.ts';

const CONFIG: DnsFieldConfig = {
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
	identityFields: ['k8s.node', 'k8s.namespace', 'k8s.podName', 'netns_id']
};

let nextMsgId = 0;
/** Arbitrary realistic epoch base so relative test timestamps never collide with the "unset" (0) sentinel. */
const BASE_TS_MS = 1_700_000_000_000;
/** Build a minimal raw trace_dns event. Times are in ms and converted to the ns epoch the correlator expects. */
function makeEvent(opts: {
	isResponse: boolean;
	tsMs: number;
	id?: string;
	name?: string;
	qtypeRaw?: number;
	srcAddr: string;
	srcPort: number;
	dstAddr: string;
	dstPort: number;
	node?: string;
	namespace?: string;
	pod?: string;
	netnsId?: number;
	proto?: string;
	pktTypeRaw?: number;
	latencyNsRaw?: number;
	rcode?: string;
	msgID?: number;
}): Record<string, unknown> {
	return {
		id: opts.id ?? 'abcd',
		qr_raw: opts.isResponse,
		name: opts.name ?? 'example.com.',
		qtype_raw: opts.qtypeRaw ?? 1,
		qtype: 'A',
		'src.addr': opts.srcAddr,
		'src.port': opts.srcPort,
		'dst.addr': opts.dstAddr,
		'dst.port': opts.dstPort,
		'src.proto': opts.proto ?? 'UDP',
		timestamp_raw: (BASE_TS_MS + opts.tsMs) * 1e6,
		'k8s.node': opts.node ?? 'node-a',
		'k8s.namespace': opts.namespace ?? 'default',
		'k8s.podName': opts.pod ?? 'pod-a',
		netns_id: opts.netnsId ?? 4026531840,
		pkt_type_raw: opts.pktTypeRaw ?? 0,
		pkt_type:
			opts.pktTypeRaw === 1
				? 'BROADCAST'
				: opts.pktTypeRaw === 2
					? 'MULTICAST'
					: opts.pktTypeRaw === 4
						? 'OUTGOING'
						: 'HOST',
		latency_ns_raw: opts.latencyNsRaw ?? 0,
		rcode: opts.rcode,
		msgID: opts.msgID ?? nextMsgId++
	};
}

const REQUESTER = { addr: '10.0.0.5', port: 40000 };
const NAMESERVER = { addr: '10.0.0.53', port: 53 };

test('query + matching response correlate into one answered transaction', () => {
	const request = makeEvent({
		isResponse: false,
		tsMs: 1000,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: NAMESERVER.port
	});
	const response = makeEvent({
		isResponse: true,
		tsMs: 1010,
		srcAddr: NAMESERVER.addr,
		srcPort: NAMESERVER.port,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port,
		rcode: 'Success'
	});

	const result = computeDnsCorrelation([request, response], CONFIG, BASE_TS_MS + 2000, {
		timeoutMs: 5000
	});

	assert.equal(result.transactions.length, 1);
	assert.equal(result.pendingCount, 0);
	const txn = result.transactions[0];
	assert.equal(txn.state, 'answered');
	assert.equal(txn.attemptCount, 1);
	assert.equal(txn.retryCount, 0);
	assert.deepEqual(txn.requester, REQUESTER);
	assert.deepEqual(txn.nameserver, NAMESERVER);
	assert.equal(txn.rcode, 'Success');
});

test('reversed response endpoints still match the request-oriented transaction', () => {
	// Response src/dst reversed relative to the request confirms our normalization
	// (requester -> nameserver) rather than raw src/dst equality.
	const request = makeEvent({
		isResponse: false,
		tsMs: 0,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: NAMESERVER.port
	});
	const response = makeEvent({
		isResponse: true,
		tsMs: 5,
		srcAddr: NAMESERVER.addr,
		srcPort: NAMESERVER.port,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port
	});

	const result = computeDnsCorrelation([request, response], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	assert.equal(result.transactions.length, 1);
	assert.equal(result.transactions[0].state, 'answered');
});

test('same DNS id used by different peers does not collide', () => {
	const req1 = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'aaaa',
		srcAddr: '10.0.0.1',
		srcPort: 1111,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const req2 = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'aaaa',
		srcAddr: '10.0.0.2',
		srcPort: 2222,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const resp1 = makeEvent({
		isResponse: true,
		tsMs: 10,
		id: 'aaaa',
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: '10.0.0.1',
		dstPort: 1111
	});

	// Only req1 gets a response; req2 must remain pending, not falsely answered.
	const result = computeDnsCorrelation([req1, req2, resp1], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	assert.equal(result.transactions.length, 1);
	assert.equal(result.transactions[0].requester.addr, '10.0.0.1');
	assert.equal(result.pendingCount, 1);
});

test('same DNS id across different k8s namespaces does not collide', () => {
	const reqA = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'beef',
		namespace: 'ns-a',
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const reqB = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'beef',
		namespace: 'ns-b',
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const respA = makeEvent({
		isResponse: true,
		tsMs: 10,
		id: 'beef',
		namespace: 'ns-a',
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port
	});

	const result = computeDnsCorrelation([reqA, reqB, respA], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	const answered = result.transactions.filter((t) => t.state === 'answered');
	assert.equal(answered.length, 1);
	assert.equal(result.pendingCount, 1);
});

test('same DNS id with identical k8s identity but different netns_id does not collide', () => {
	// Two peers that look identical on every k8s field (same node/namespace/pod -
	// e.g. hostNetwork pods, or a non-k8s capture where those fields are simply
	// absent) but live in different network namespaces must still be
	// disambiguated via netns_id, not silently merged/dropped.
	const reqA = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'beef',
		netnsId: 111111,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const reqB = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'beef',
		netnsId: 222222,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const respA = makeEvent({
		isResponse: true,
		tsMs: 10,
		id: 'beef',
		netnsId: 111111,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port
	});

	const result = computeDnsCorrelation([reqA, reqB, respA], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	const answered = result.transactions.filter((t) => t.state === 'answered');
	assert.equal(answered.length, 1, 'only the netns_id=111111 request should be answered');
	assert.equal(
		result.pendingCount,
		1,
		'the netns_id=222222 request must remain pending, not falsely answered'
	);
});

test('same DNS id with different names does not collide', () => {
	const req1 = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'cafe',
		name: 'foo.example.',
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const req2 = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'cafe',
		name: 'bar.example.',
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const resp2 = makeEvent({
		isResponse: true,
		tsMs: 10,
		id: 'cafe',
		name: 'bar.example.',
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port
	});

	const result = computeDnsCorrelation([req1, req2, resp2], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	const answered = result.transactions.filter((t) => t.state === 'answered');
	assert.equal(answered.length, 1);
	assert.equal(answered[0].name, 'bar.example.');
	assert.equal(result.pendingCount, 1);
});

test('same DNS id with different qtypes does not collide', () => {
	const reqA = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'dead',
		qtypeRaw: 1,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const reqAAAA = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'dead',
		qtypeRaw: 28,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const respAAAA = makeEvent({
		isResponse: true,
		tsMs: 10,
		id: 'dead',
		qtypeRaw: 28,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port
	});

	const result = computeDnsCorrelation([reqA, reqAAAA, respAAAA], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	const answered = result.transactions.filter((t) => t.state === 'answered');
	assert.equal(answered.length, 1);
	assert.equal(answered[0].qtypeRaw, 28);
	assert.equal(result.pendingCount, 1);
});

test('retransmitted request increments attemptCount/retryCount and keeps the first timestamp', () => {
	const req1 = makeEvent({
		isResponse: false,
		tsMs: 0,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const req2 = makeEvent({
		isResponse: false,
		tsMs: 200,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const req3 = makeEvent({
		isResponse: false,
		tsMs: 400,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const resp = makeEvent({
		isResponse: true,
		tsMs: 450,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port
	});

	const result = computeDnsCorrelation([req1, req2, req3, resp], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	assert.equal(result.transactions.length, 1);
	const txn = result.transactions[0];
	assert.equal(txn.attemptCount, 3);
	assert.equal(txn.retryCount, 2);
	assert.equal(txn.firstRequestTime, BASE_TS_MS);
	assert.equal(txn.latestAttemptTime, BASE_TS_MS + 400);
});

test('a query with no response finalizes as no-response only after the configured timeout', () => {
	const request = makeEvent({
		isResponse: false,
		tsMs: 0,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});

	// Well within the timeout: must not be rendered at all (pending, not "unanswered").
	const early = computeDnsCorrelation([request], CONFIG, BASE_TS_MS + 1000, { timeoutMs: 5000 });
	assert.equal(early.transactions.length, 0);
	assert.equal(early.pendingCount, 1);
	assert.equal(early.nextDeadlineMs, BASE_TS_MS + 5000);

	// Past the deadline: finalizes as no-response.
	const late = computeDnsCorrelation([request], CONFIG, BASE_TS_MS + 5001, { timeoutMs: 5000 });
	assert.equal(late.transactions.length, 1);
	assert.equal(late.transactions[0].state, 'no-response');
	assert.equal(late.pendingCount, 0);
});

test('a late response updates the timed-out transaction instead of disappearing', () => {
	const request = makeEvent({
		isResponse: false,
		tsMs: 0,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const response = makeEvent({
		isResponse: true,
		tsMs: 6000,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port
	});

	const result = computeDnsCorrelation([request, response], CONFIG, BASE_TS_MS + 7000, {
		timeoutMs: 5000
	});
	assert.equal(result.transactions.length, 1);
	assert.equal(result.transactions[0].state, 'late-response');
	assert.equal(result.pendingCount, 0);
});

test('a response with no matching pending request is an orphan-response', () => {
	const response = makeEvent({
		isResponse: true,
		tsMs: 10,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port
	});

	const result = computeDnsCorrelation([response], CONFIG, BASE_TS_MS + 1000, { timeoutMs: 5000 });
	assert.equal(result.transactions.length, 1);
	assert.equal(result.transactions[0].state, 'orphan-response');
	assert.equal(result.transactions[0].attemptCount, 0);
});

test('duplicate msgID events are deduplicated', () => {
	const request = makeEvent({
		isResponse: false,
		tsMs: 0,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53,
		msgID: 500
	});
	const response = makeEvent({
		isResponse: true,
		tsMs: 10,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port,
		msgID: 501
	});

	// Duplicate the request (same msgID) as if it had been processed twice from
	// overlapping ring-buffer reads.
	const result = computeDnsCorrelation([request, request, response], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	assert.equal(result.transactions.length, 1);
	assert.equal(
		result.transactions[0].attemptCount,
		1,
		'duplicate request must not count as a retry'
	);
});

test('ring-buffer wrap: only currently-retained events participate, no stale carryover', () => {
	// Simulate a ring buffer that has evicted the very first request but still
	// retains a retry and the response - correlation must still succeed cleanly
	// using only what's currently present.
	const retry = makeEvent({
		isResponse: false,
		tsMs: 100,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const response = makeEvent({
		isResponse: true,
		tsMs: 110,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port
	});

	const result = computeDnsCorrelation([retry, response], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	assert.equal(result.transactions.length, 1);
	assert.equal(result.transactions[0].state, 'answered');
	assert.equal(result.transactions[0].attemptCount, 1);
});

test('mDNS/multicast traffic is marked ambiguous, not one-to-one no-response', () => {
	const query = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: '0',
		// Outgoing (locally-originated) queries are classified PACKET_OUTGOING
		// (4) by trace_dns, not BROADCAST/MULTICAST - those values only apply
		// to *incoming* packets. Ambiguity here must come from the multicast
		// destination address/port, not pkt_type_raw.
		pktTypeRaw: 4,
		srcAddr: '192.168.1.10',
		srcPort: 5353,
		dstAddr: '224.0.0.251',
		dstPort: 5353
	});
	const announce1 = makeEvent({
		isResponse: true,
		tsMs: 5,
		id: '0',
		pktTypeRaw: 2,
		srcAddr: '192.168.1.20',
		srcPort: 5353,
		dstAddr: '224.0.0.251',
		dstPort: 5353
	});
	const announce2 = makeEvent({
		isResponse: true,
		tsMs: 6,
		id: '0',
		pktTypeRaw: 2,
		srcAddr: '192.168.1.30',
		srcPort: 5353,
		dstAddr: '224.0.0.251',
		dstPort: 5353
	});

	const result = computeDnsCorrelation([query, announce1, announce2], CONFIG, BASE_TS_MS + 5000, {
		timeoutMs: 5000
	});
	assert.equal(result.transactions.length, 3);
	assert.ok(result.transactions.every((t) => t.state === 'ambiguous'));
	assert.equal(
		result.pendingCount,
		0,
		'ambiguous traffic must never be counted as pending/no-response'
	);
});

test('outgoing mDNS query (pkt_type_raw=PACKET_OUTGOING) to a multicast destination is ambiguous, not a false no-response', () => {
	// Locally-originated mDNS/LLMNR queries are captured as PACKET_OUTGOING
	// (4) by trace_dns, not BROADCAST (1) / MULTICAST (2) - those packet-type
	// values only classify *incoming* packets. Regression test for treating
	// this as an ordinary one-to-one query, which would otherwise sit pending
	// and eventually render as a false "no-response" once the deadline
	// passes, even though mDNS never resolves one-to-one.
	const outgoingQuery = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: '0',
		pktTypeRaw: 4,
		srcAddr: '192.168.1.10',
		srcPort: 5353,
		dstAddr: '224.0.0.251',
		dstPort: 5353
	});

	// Well past the response timeout - a real one-to-one query would have
	// finalized as "no-response" by now.
	const result = computeDnsCorrelation([outgoingQuery], CONFIG, BASE_TS_MS + 60_000, {
		timeoutMs: 5000
	});

	assert.equal(result.transactions.length, 1);
	assert.equal(result.transactions[0].state, 'ambiguous');
	assert.ok(
		result.transactions.every((t) => t.state !== 'no-response'),
		'outgoing multicast queries must never render as no-response'
	);
	assert.equal(result.pendingCount, 0);
});

test('IPv6 multicast (ff02::/8) and LLMNR port 5355 are also detected as ambiguous', () => {
	const ipv6Query = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: '0',
		pktTypeRaw: 4,
		srcAddr: 'fe80::1',
		srcPort: 5353,
		dstAddr: 'ff02::fb',
		dstPort: 5353
	});
	const llmnrQuery = makeEvent({
		isResponse: false,
		tsMs: 100,
		id: '0',
		pktTypeRaw: 4,
		srcAddr: '192.168.1.10',
		srcPort: 5355,
		dstAddr: '224.0.0.252',
		dstPort: 5355
	});

	const result = computeDnsCorrelation([ipv6Query, llmnrQuery], CONFIG, BASE_TS_MS + 60_000, {
		timeoutMs: 5000
	});

	assert.equal(result.transactions.length, 2);
	assert.ok(result.transactions.every((t) => t.state === 'ambiguous'));
	assert.equal(result.pendingCount, 0);
});

test('peer keys are stable regardless of ephemeral request port', () => {
	const req1 = makeEvent({
		isResponse: false,
		tsMs: 0,
		srcAddr: REQUESTER.addr,
		srcPort: 40000,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const resp1 = makeEvent({
		isResponse: true,
		tsMs: 10,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: 40000
	});
	const req2 = makeEvent({
		isResponse: false,
		tsMs: 20,
		srcAddr: REQUESTER.addr,
		srcPort: 40999,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const resp2 = makeEvent({
		isResponse: true,
		tsMs: 30,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: 40999
	});

	const result = computeDnsCorrelation([req1, resp1, req2, resp2], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	assert.equal(result.transactions.length, 2);
	assert.equal(result.transactions[0].peerKey, result.transactions[1].peerKey);
});

test('the latest five transactions for a peer are the five most recent, newest first', () => {
	const events: Record<string, unknown>[] = [];
	for (let i = 0; i < 8; i++) {
		events.push(
			makeEvent({
				isResponse: false,
				tsMs: i * 100,
				id: `id${i}`,
				srcAddr: REQUESTER.addr,
				srcPort: 40000 + i,
				dstAddr: NAMESERVER.addr,
				dstPort: 53
			})
		);
		events.push(
			makeEvent({
				isResponse: true,
				tsMs: i * 100 + 10,
				id: `id${i}`,
				srcAddr: NAMESERVER.addr,
				srcPort: 53,
				dstAddr: REQUESTER.addr,
				dstPort: 40000 + i
			})
		);
	}

	const result = computeDnsCorrelation(events, CONFIG, BASE_TS_MS + 10000, { timeoutMs: 5000 });
	assert.equal(result.transactions.length, 8);
	const latestFive = result.transactions.slice(0, 5);
	// Newest first: the displayed primary time (what the Time column shows)
	// must be monotonically non-increasing, since network-view "latest N"
	// grouping and the transaction table both rely on this same sort order.
	for (let i = 1; i < latestFive.length; i++) {
		assert.ok((primaryTime(latestFive[i - 1]) ?? 0) >= (primaryTime(latestFive[i]) ?? 0));
	}
	assert.equal(latestFive[0].dnsId, 'id7');
});

test('sort order matches the displayed primary time (first-request chronology), not response time', () => {
	// Regression test: the correlator must sort transactions by the same
	// time it displays (first request time), not by response time - otherwise
	// "newest first" ordering (and the network view's per-peer "latest N"
	// slice, which relies on this same global sort) would silently disagree
	// with the timestamp shown in the Time column.
	//
	// 'slow' is requested first (tsMs=0) but its response arrives late
	// (tsMs=4000, still within the 5s timeout). 'fast' is requested later
	// (tsMs=1000) but answered almost immediately (tsMs=1010). Sorting by
	// responseTime would incorrectly rank 'slow' (responseTime=4000) ahead of
	// 'fast' (responseTime=1010); sorting by first-request time correctly
	// ranks 'fast' (requested at 1000) ahead of 'slow' (requested at 0).
	const slowRequest = makeEvent({
		isResponse: false,
		tsMs: 0,
		id: 'slow',
		srcAddr: REQUESTER.addr,
		srcPort: 41001,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const slowResponse = makeEvent({
		isResponse: true,
		tsMs: 4000,
		id: 'slow',
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: 41001
	});
	const fastRequest = makeEvent({
		isResponse: false,
		tsMs: 1000,
		id: 'fast',
		srcAddr: REQUESTER.addr,
		srcPort: 41002,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const fastResponse = makeEvent({
		isResponse: true,
		tsMs: 1010,
		id: 'fast',
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: 41002
	});

	const result = computeDnsCorrelation(
		[slowRequest, slowResponse, fastRequest, fastResponse],
		CONFIG,
		BASE_TS_MS + 5000,
		{ timeoutMs: 5000 }
	);

	assert.equal(result.transactions.length, 2);
	assert.equal(result.transactions[0].dnsId, 'fast', 'requested later, must sort first');
	assert.equal(result.transactions[1].dnsId, 'slow', 'requested earlier, must sort second');
	// The correlator's ordering and the displayed primary time must agree.
	assert.ok(
		(primaryTime(result.transactions[0]) ?? 0) >= (primaryTime(result.transactions[1]) ?? 0)
	);
});

test('do not infer success/failure from latency_ns_raw === 0', () => {
	const request = makeEvent({
		isResponse: false,
		tsMs: 0,
		srcAddr: REQUESTER.addr,
		srcPort: REQUESTER.port,
		dstAddr: NAMESERVER.addr,
		dstPort: 53
	});
	const response = makeEvent({
		isResponse: true,
		tsMs: 10,
		srcAddr: NAMESERVER.addr,
		srcPort: 53,
		dstAddr: REQUESTER.addr,
		dstPort: REQUESTER.port,
		latencyNsRaw: 0
	});

	const result = computeDnsCorrelation([request, response], CONFIG, BASE_TS_MS + 1000, {
		timeoutMs: 5000
	});
	assert.equal(result.transactions.length, 1);
	assert.equal(result.transactions[0].state, 'answered');
	// latencyNs falls back to the computed request/response delta (~10ms = ~1e7 ns) rather than 0.
	// Exact ns precision isn't guaranteed at real epoch-ns magnitudes (see resolveEventTimeMs
	// doc comment on float64 precision), so assert closeness rather than exact equality.
	const latencyNs = result.transactions[0].latencyNs ?? 0;
	assert.ok(
		Math.abs(latencyNs - 10 * 1e6) < 1e4,
		`expected latencyNs close to 1e7, got ${latencyNs}`
	);
});
