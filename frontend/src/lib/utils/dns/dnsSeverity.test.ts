/**
 * Pure unit tests for the DNS severity ladder and its small set of display
 * helpers - the single source of truth both the edge/workload/resolver
 * cards and the edge path's at-a-glance color rely on.
 *
 * Run with: node --test frontend/src/lib/utils/dns/dnsSeverity.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	isNxDomainRcode,
	isServerErrorRcode,
	primarySeverityReason,
	severityCardClass,
	severityColorClass,
	severityEdgeClass,
	severityIcon,
	severityLabel,
	slowThresholdNs,
	summarizeDnsSeverity,
	transactionSeverity,
	worseSeverity,
	type DnsSeverity
} from './dnsSeverity.ts';
import type { DnsTransaction } from './dnsTypes.ts';

const REQUESTER = { addr: '10.0.0.5', port: 40000 };
const NAMESERVER = { addr: '10.0.0.53', port: 53 };

function makeTxn(overrides: Partial<DnsTransaction>): DnsTransaction {
	return {
		id: 'txn-1',
		peerKey: 'peer-1',
		identity: 'identity-1',
		requester: REQUESTER,
		nameserver: NAMESERVER,
		dnsId: 'abcd',
		name: 'example.com.',
		qtype: 'A',
		state: 'answered',
		attemptCount: 1,
		retryCount: 0,
		...overrides
	};
}

const SLOW_NS = slowThresholdNs(5000); // 500ms

test('rcode classification: server errors and NXDOMAIN are distinguished by rcode_raw first, then rcode name', () => {
	assert.equal(isServerErrorRcode(1, undefined), true); // FormatError
	assert.equal(isServerErrorRcode(2, undefined), true); // ServerFailure
	assert.equal(isServerErrorRcode(4, undefined), true); // NotImplemented
	assert.equal(isServerErrorRcode(5, undefined), true); // Refused
	assert.equal(isServerErrorRcode(3, undefined), false); // NXDOMAIN is not a server error
	assert.equal(isServerErrorRcode(undefined, 'ServerFailure'), true);
	assert.equal(isServerErrorRcode(undefined, 'Success'), false);

	assert.equal(isNxDomainRcode(3, undefined), true);
	assert.equal(isNxDomainRcode(undefined, 'NameError'), true);
	assert.equal(isNxDomainRcode(0, undefined), false);
});

test('severity ladder: error beats warning beats info beats healthy, in that evaluation order', () => {
	assert.equal(transactionSeverity(makeTxn({ state: 'no-response' }), SLOW_NS), 'error');
	assert.equal(transactionSeverity(makeTxn({ state: 'answered', rcodeRaw: 2 }), SLOW_NS), 'error');
	assert.equal(transactionSeverity(makeTxn({ state: 'late-response' }), SLOW_NS), 'warning');
	assert.equal(transactionSeverity(makeTxn({ retryCount: 1 }), SLOW_NS), 'warning');
	assert.equal(transactionSeverity(makeTxn({ latencyNs: SLOW_NS + 1 }), SLOW_NS), 'warning');
	assert.equal(
		transactionSeverity(makeTxn({ rcodeRaw: 3 }), SLOW_NS),
		'info' // NXDOMAIN-only
	);
	assert.equal(transactionSeverity(makeTxn({ state: 'orphan-response' }), SLOW_NS), 'info');
	assert.equal(transactionSeverity(makeTxn({ state: 'ambiguous' }), SLOW_NS), 'info');
	assert.equal(transactionSeverity(makeTxn({}), SLOW_NS), 'healthy');

	// A server error still wins even on an otherwise-"info" orphan response.
	assert.equal(
		transactionSeverity(makeTxn({ state: 'orphan-response', rcodeRaw: 2 }), SLOW_NS),
		'error'
	);
});

test('worseSeverity picks the higher-priority severity regardless of argument order', () => {
	const order: DnsSeverity[] = ['healthy', 'info', 'warning', 'error'];
	for (let i = 0; i < order.length; i++) {
		for (let j = 0; j < order.length; j++) {
			const expected = order[Math.max(i, j)];
			assert.equal(worseSeverity(order[i], order[j]), expected);
		}
	}
});

test('summarizeDnsSeverity aggregates counts and derives the worst severity across all transactions', () => {
	const txns = [
		makeTxn({ id: 't1', state: 'no-response' }),
		makeTxn({ id: 't2', rcodeRaw: 3 }), // NXDOMAIN
		makeTxn({ id: 't3', latencyNs: 10, retryCount: 0 })
	];
	const summary = summarizeDnsSeverity(txns, 5000);
	assert.equal(summary.total, 3);
	assert.equal(summary.timeoutCount, 1);
	assert.equal(summary.nxdomainCount, 1);
	assert.equal(summary.severity, 'error');
	assert.equal(summary.errorCount, 1);
	assert.equal(summary.infoCount, 1);
	assert.equal(summary.healthyCount, 1);
	assert.equal(summary.warningCount, 0);
});

test('a transaction that is both late AND slow counts once as one warning, not two (distinct counts never sum dimensions)', () => {
	const txn = makeTxn({
		id: 'late-and-slow',
		state: 'late-response',
		latencyNs: SLOW_NS + 1_000_000 // well past the slow threshold too
	});
	const summary = summarizeDnsSeverity([txn], 5000);
	assert.equal(summary.total, 1);
	assert.equal(summary.severity, 'warning');
	assert.equal(summary.warningCount, 1, 'exactly one warning, despite two warning reasons');
	assert.equal(summary.errorCount, 0);
	assert.equal(summary.infoCount, 0);
	assert.equal(summary.healthyCount, 0);
	// The reason/dimension counters may both still be set - that's fine for
	// a detailed breakdown, just never used as a substitute for the single
	// distinct count above.
	assert.equal(summary.lateCount, 1);
	assert.equal(summary.slowCount, 1);
});

test('primarySeverityReason picks exactly one reason in priority order, never summing dimensions', () => {
	const txns = [makeTxn({ id: 'late-and-slow', state: 'late-response', latencyNs: SLOW_NS + 1 })];
	const summary = summarizeDnsSeverity(txns, 5000);
	// Both lateCount and slowCount are 1, but the primary reason is exactly
	// one of them (late has priority over slow), not "2" of anything.
	const reason = primarySeverityReason(summary);
	assert.ok(reason);
	assert.equal(reason!.count, 1);
	assert.equal(reason!.labelKey, '{{count}} late');

	// Server error outranks timeout/NXDOMAIN when multiple are present.
	const mixed = summarizeDnsSeverity(
		[makeTxn({ id: 'servfail', rcodeRaw: 2 }), makeTxn({ id: 'timeout', state: 'no-response' })],
		5000
	);
	const mixedReason = primarySeverityReason(mixed);
	assert.equal(mixedReason?.labelKey, '{{count}} server error');
	assert.equal(mixedReason?.count, 1);

	// Healthy aggregate has no reason to show.
	const healthy = summarizeDnsSeverity([makeTxn({})], 5000);
	assert.equal(primarySeverityReason(healthy), undefined);
});

test('display helpers are unique and non-empty per severity, and never rely on color alone', () => {
	const severities: DnsSeverity[] = ['error', 'warning', 'info', 'healthy'];
	const colorClasses = new Set(severities.map(severityColorClass));
	const icons = new Set(severities.map(severityIcon));
	const labels = new Set(severities.map(severityLabel));
	const edgeClasses = new Set(severities.map(severityEdgeClass));
	const cardClasses = new Set(severities.map(severityCardClass));

	assert.equal(colorClasses.size, 4, 'each severity has a distinct color class');
	assert.equal(icons.size, 4, 'each severity has a distinct icon glyph');
	assert.equal(labels.size, 4, 'each severity has a distinct text label');
	assert.equal(edgeClasses.size, 4, 'each severity has a distinct edge path class');
	assert.equal(cardClasses.size, 4, 'each severity has a distinct card class');
	assert.equal(severityIcon('error'), '▲');

	for (const s of severities) {
		assert.ok(severityColorClass(s).length > 0);
		assert.ok(severityIcon(s).length > 0);
		assert.ok(severityLabel(s).length > 0);
		assert.equal(severityEdgeClass(s), `dns-map-edge-path--${s}`);
		assert.equal(severityCardClass(s), `dns-map-edge-card--${s}`);
	}
});
