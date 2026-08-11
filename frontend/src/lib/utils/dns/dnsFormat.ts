/**
 * Presentation helpers shared by the DNS transaction table and network views.
 */

import type { TOptions } from 'i18next';
import type {
	DnsCaptureMeta,
	DnsEndpoint,
	DnsK8sRef,
	DnsTransaction,
	DnsTransactionState
} from './dnsTypes';

/** Format a requester/nameserver endpoint as `addr:port` (port omitted when 0/unset). */
export function formatEndpoint(endpoint: DnsEndpoint | undefined): string {
	if (!endpoint) return '';
	return endpoint.port ? `${endpoint.addr}:${endpoint.port}` : endpoint.addr;
}

/** Prefer authoritative Kubernetes identity, then capture metadata, unless raw output is requested. */
export function formatDnsEndpointIdentity(
	endpoint: DnsEndpoint,
	meta?: DnsCaptureMeta,
	k8s?: DnsK8sRef,
	showRaw = false
): string {
	if (showRaw) return formatEndpoint(endpoint);

	if (k8s) {
		const name = `${k8s.kind} ${k8s.namespace ? `${k8s.namespace}/` : ''}${k8s.name}`;
		return meta?.containerName ? `${name} (${meta.containerName})` : name;
	}

	const workload = meta?.podName ?? meta?.runtimeContainerName;
	if (workload) {
		const name = meta?.namespace ? `${meta.namespace}/${workload}` : workload;
		return meta?.podName && meta.containerName ? `${name} (${meta.containerName})` : name;
	}

	return meta?.runtimeContainerId ?? formatEndpoint(endpoint);
}

/** Format a nanosecond duration as a compact human string (µs/ms/s). */
export function formatLatencyNs(latencyNs: number | undefined): string {
	if (latencyNs === undefined || !Number.isFinite(latencyNs)) return '';
	if (latencyNs < 1000) return `${Math.round(latencyNs)}ns`;
	if (latencyNs < 1_000_000) return `${(latencyNs / 1000).toFixed(1)}µs`;
	if (latencyNs < 1_000_000_000) return `${(latencyNs / 1_000_000).toFixed(1)}ms`;
	return `${(latencyNs / 1_000_000_000).toFixed(2)}s`;
}

/** Semantic ig-* text color token for a transaction state. */
export function stateColorClass(state: DnsTransactionState): string {
	switch (state) {
		case 'answered':
			return 'text-ig-success';
		case 'no-response':
			return 'text-ig-error';
		case 'late-response':
			return 'text-ig-warning';
		case 'orphan-response':
			return 'text-ig-warning';
		case 'ambiguous':
			return 'text-ig-text-muted';
	}
}

/** Human-readable label for a transaction state. */
export function stateLabel(state: DnsTransactionState): string {
	switch (state) {
		case 'answered':
			return 'Answered';
		case 'no-response':
			return 'No response';
		case 'late-response':
			return 'Late response';
		case 'orphan-response':
			return 'Orphan response';
		case 'ambiguous':
			return 'Ambiguous (mDNS)';
	}
}

/**
 * Best available time for a transaction row (request time, falling back to
 * response time for orphans). This is also the exact ordering key the
 * correlator sorts transactions by (see `sortTime` in dnsCorrelator.ts) -
 * keep the two in sync so "newest first" ordering always matches what's
 * displayed in the Time column.
 */
export function primaryTime(txn: DnsTransaction): number | undefined {
	return txn.firstRequestTime ?? txn.responseTime;
}

/** Attempts/retries summary, e.g. "3 (2 retries)" or "1". */
export function attemptsSummary(
	txn: DnsTransaction,
	t: (key: string, options?: TOptions) => string
): string {
	if (txn.attemptCount <= 0) return '-';
	if (txn.retryCount <= 0) return String(txn.attemptCount);
	return `${txn.attemptCount} (${t('{{count}} retry', { count: txn.retryCount })})`;
}
