/**
 * DNS Visualizer Plugin
 *
 * Adds two visualizers for trace_dns-compatible datasources:
 *   - `dns-transactions`: one row per correlated request/response transaction.
 *   - `dns-network`: namespace-grouped workload -> resolver DNS map with
 *     severity-first aggregation (see docs/DNS_MAP.md).
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';
import { REQUIRED_DNS_FIELDS } from '$lib/utils/dns/dnsConfig';

const transactionsIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h7"/><path d="M18 15l3 3-3 3"/></svg>`;

const networkIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7.8 10.5L17 6M7.8 13.5L17 18"/></svg>`;

export const manifest: PluginManifest = {
	id: 'builtin:dns',
	name: 'DNS',
	version: '1.0.0',
	description: 'Correlate trace_dns queries and responses into transactions and a peer graph',

	visualizers: [
		{
			id: 'dns-transactions',
			displayName: 'DNS Transactions',
			icon: transactionsIcon,
			component: 'DnsTransactions.svelte',
			applicableWhen: {
				// Restrictive trace-DNS field signature - not just the datasource name.
				hasField: REQUIRED_DNS_FIELDS
			},
			priority: 80
		},
		{
			id: 'dns-network',
			displayName: 'DNS Map',
			icon: networkIcon,
			component: 'DnsNetwork.svelte',
			applicableWhen: {
				hasField: REQUIRED_DNS_FIELDS
			},
			priority: 75
		}
	]
};
