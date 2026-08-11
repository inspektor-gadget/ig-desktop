/**
 * Single source of truth for DNS transaction/aggregate severity.
 *
 * Severity drives both the map's visual triage (icon + semantic color,
 * never color alone) and the "Issues only" filter, so every count and
 * classification a user sees is derived from these functions - never
 * duplicated ad hoc in a component.
 */

import type { DnsTransaction } from './dnsTypes.ts';

export type DnsSeverity = 'error' | 'warning' | 'info' | 'healthy';

/** rcode_raw values that indicate a server-side failure (not "no such name"). */
const SERVER_ERROR_RCODES_RAW = new Set([1, 2, 4, 5]);
/** Display-name fallback when only `rcode` (string) is available. */
const SERVER_ERROR_RCODE_NAMES = new Set([
	'FormatError',
	'ServerFailure',
	'NotImplemented',
	'Refused'
]);
const NXDOMAIN_RCODE_RAW = 3;
const NXDOMAIN_RCODE_NAME = 'NameError';

export function isServerErrorRcode(
	rcodeRaw: number | undefined,
	rcode: string | undefined
): boolean {
	if (rcodeRaw !== undefined) return SERVER_ERROR_RCODES_RAW.has(rcodeRaw);
	if (rcode) return SERVER_ERROR_RCODE_NAMES.has(rcode);
	return false;
}

export function isNxDomainRcode(rcodeRaw: number | undefined, rcode: string | undefined): boolean {
	if (rcodeRaw !== undefined) return rcodeRaw === NXDOMAIN_RCODE_RAW;
	if (rcode) return rcode === NXDOMAIN_RCODE_NAME;
	return false;
}

/**
 * Slow-response threshold in nanoseconds, derived from the datasource's
 * response timeout (timeoutMs / 10) rather than a separate hardcoded
 * constant - a longer configured timeout implies a more tolerant
 * environment, so "slow" should scale with it.
 */
export function slowThresholdNs(timeoutMs: number): number {
	return (timeoutMs / 10) * 1e6;
}

/**
 * Severity ladder (most severe wins, evaluated in order):
 *   error   - no-response (timeout) or a server-error rcode
 *   warning - late-response, any retry, or latency >= the slow threshold
 *   info    - NXDOMAIN-only, orphan-response, or ambiguous (mDNS/multicast)
 *   healthy - otherwise (answered, on time, no retries, non-error rcode)
 */
export function transactionSeverity(txn: DnsTransaction, slowNs: number): DnsSeverity {
	const serverError = isServerErrorRcode(txn.rcodeRaw, txn.rcode);
	if (txn.state === 'no-response' || serverError) return 'error';

	const slow = txn.latencyNs !== undefined && txn.latencyNs >= slowNs;
	if (txn.state === 'late-response' || txn.retryCount > 0 || slow) return 'warning';

	const nxdomain = isNxDomainRcode(txn.rcodeRaw, txn.rcode);
	if (nxdomain || txn.state === 'orphan-response' || txn.state === 'ambiguous') return 'info';

	return 'healthy';
}

const SEVERITY_RANK: Record<DnsSeverity, number> = { healthy: 0, info: 1, warning: 2, error: 3 };

/** Worst (highest-priority) of two severities. */
export function worseSeverity(a: DnsSeverity, b: DnsSeverity): DnsSeverity {
	return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Aggregate counts/severity derived from a set of transactions - the one source of truth for edge/node summaries. */
export interface DnsSeverityCounts {
	total: number;
	/** Distinct per-severity transaction counts: each transaction is classified via `transactionSeverity` exactly once and counted in exactly one of these four buckets (never summed across dimensions - a single late+slow transaction counts once, as one warning). */
	errorCount: number;
	warningCount: number;
	infoCount: number;
	healthyCount: number;
	/** Reason/dimension counters - a transaction may set several of these at once (e.g. late AND slow); keep these for detailed breakdowns (e.g. edge cards), never as a substitute for the distinct counts above. */
	timeoutCount: number;
	serverErrorCount: number;
	nxdomainCount: number;
	retryingCount: number;
	lateCount: number;
	slowCount: number;
	worstLatencyNs?: number;
	/** Latency of the most recent (by primaryTime) transaction that has one. */
	recentLatencyNs?: number;
	severity: DnsSeverity;
}

/**
 * Summarize a set of transactions (already ordered newest-first, matching
 * `computeDnsCorrelation`'s output) into the counts/severity shown on an
 * edge or node card. Pure and total: given the same transactions, always
 * the same result - no hidden state, no re-aggregation across calls.
 */
export function summarizeDnsSeverity(txns: DnsTransaction[], timeoutMs: number): DnsSeverityCounts {
	const slowNs = slowThresholdNs(timeoutMs);
	let severity: DnsSeverity = 'healthy';
	let errorCount = 0;
	let warningCount = 0;
	let infoCount = 0;
	let healthyCount = 0;
	let timeoutCount = 0;
	let serverErrorCount = 0;
	let nxdomainCount = 0;
	let retryingCount = 0;
	let lateCount = 0;
	let slowCount = 0;
	let worstLatencyNs: number | undefined;
	let recentLatencyNs: number | undefined;

	for (const txn of txns) {
		// Classify each transaction exactly once - `s` is both the input to
		// the aggregate `severity` and the sole distinct-count increment
		// below, so a transaction that happens to be late AND slow (both
		// "warning" reasons) still counts as exactly one warning, never two.
		const s = transactionSeverity(txn, slowNs);
		severity = worseSeverity(severity, s);
		switch (s) {
			case 'error':
				errorCount++;
				break;
			case 'warning':
				warningCount++;
				break;
			case 'info':
				infoCount++;
				break;
			case 'healthy':
				healthyCount++;
				break;
		}

		if (txn.state === 'no-response') timeoutCount++;
		if (isServerErrorRcode(txn.rcodeRaw, txn.rcode)) serverErrorCount++;
		if (isNxDomainRcode(txn.rcodeRaw, txn.rcode)) nxdomainCount++;
		if (txn.retryCount > 0) retryingCount++;
		if (txn.state === 'late-response') lateCount++;
		if (txn.latencyNs !== undefined && txn.latencyNs >= slowNs) slowCount++;
		if (txn.latencyNs !== undefined) {
			if (worstLatencyNs === undefined || txn.latencyNs > worstLatencyNs)
				worstLatencyNs = txn.latencyNs;
			if (recentLatencyNs === undefined) recentLatencyNs = txn.latencyNs;
		}
	}

	return {
		total: txns.length,
		errorCount,
		warningCount,
		infoCount,
		healthyCount,
		timeoutCount,
		serverErrorCount,
		nxdomainCount,
		retryingCount,
		lateCount,
		slowCount,
		worstLatencyNs,
		recentLatencyNs,
		severity
	};
}

/** A single, most-relevant "reason" dimension, for compact at-a-glance displays. */
export interface DnsPrimaryReason {
	count: number;
	/** i18n key with a `{{count}}` placeholder, e.g. `'{{count}} timeout'`. */
	labelKey: string;
}

/**
 * Pick the single most relevant reason dimension for a compact display
 * (e.g. a resting-state edge card) - the first non-zero dimension in
 * priority order (server error > timeout > NXDOMAIN > retrying > late >
 * slow), never summed with any other dimension (unlike the old buggy
 * behavior this replaces, which could double-count one transaction that
 * was e.g. both late and slow as "2 warnings"). Returns `undefined` when
 * there's no non-healthy reason to show.
 */
export function primarySeverityReason(counts: DnsSeverityCounts): DnsPrimaryReason | undefined {
	if (counts.serverErrorCount > 0)
		return { count: counts.serverErrorCount, labelKey: '{{count}} server error' };
	if (counts.timeoutCount > 0) return { count: counts.timeoutCount, labelKey: '{{count}} timeout' };
	if (counts.nxdomainCount > 0)
		return { count: counts.nxdomainCount, labelKey: '{{count}} NXDOMAIN' };
	if (counts.retryingCount > 0)
		return { count: counts.retryingCount, labelKey: '{{count}} retrying' };
	if (counts.lateCount > 0) return { count: counts.lateCount, labelKey: '{{count}} late' };
	if (counts.slowCount > 0) return { count: counts.slowCount, labelKey: '{{count}} slow' };
	return undefined;
}

/** Semantic ig-* text/background color token for a severity level. */
export function severityColorClass(severity: DnsSeverity): string {
	switch (severity) {
		case 'error':
			return 'text-ig-error';
		case 'warning':
			return 'text-ig-warning';
		case 'info':
			return 'text-ig-text-muted';
		case 'healthy':
			return 'text-ig-success';
	}
}

/**
 * CSS class encoding a severity level for use on non-Tailwind-aware SVG
 * elements (e.g. an XYFlow edge `<path>`) - paired with plain CSS rules
 * that reference the same `--ig-color-*` semantic variables `severityColorClass`
 * uses, so edge paths and cards always agree on color regardless of
 * Tailwind's inability to style SVG `stroke` via utility classes alone.
 */
export function severityEdgeClass(severity: DnsSeverity): string {
	return `dns-map-edge-path--${severity}`;
}

/** CSS class for a theme-aware severity-tinted card surface. */
export function severityCardClass(severity: DnsSeverity): string {
	return `dns-map-edge-card--${severity}`;
}

/** Compact icon glyph paired with the semantic color - severity is never conveyed by color alone. */
export function severityIcon(severity: DnsSeverity): string {
	switch (severity) {
		case 'error':
			return '▲';
		case 'warning':
			return '!';
		case 'info':
			return 'i';
		case 'healthy':
			return '✓';
	}
}

/** Human-readable label for a severity level. */
export function severityLabel(severity: DnsSeverity): string {
	switch (severity) {
		case 'error':
			return 'Error';
		case 'warning':
			return 'Warning';
		case 'info':
			return 'Info';
		case 'healthy':
			return 'Healthy';
	}
}
