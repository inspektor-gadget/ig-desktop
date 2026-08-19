<script lang="ts">
	import { untrack } from 'svelte';
	import DnsNetworkChart from './DnsNetworkChart.svelte';
	import BaseModal from '$lib/components/BaseModal.svelte';
	import Select from '$lib/components/forms/Select.svelte';
	import type { VisualizerPluginProps } from '$lib/types/plugin-api';
	import {
		extractDnsConfig,
		extractDnsResponseTimeoutMs,
		extractDnsViewConfig,
		showDnsNamespaceSelector
	} from '$lib/utils/dns/dnsConfig';
	import { createDnsCorrelation } from '$lib/utils/dns/useDnsCorrelation.svelte';
	import {
		buildDnsMapModel,
		extractDnsMapNamespaces,
		filterDnsMapModelIssuesOnly,
		filterTransactionsByNamespace,
		layoutDnsMapModel,
		dnsMapTopologyKey,
		refreshDnsMapLayoutData,
		type DnsMapLayout
	} from '$lib/utils/dns/dnsMapGraph';
	import {
		formatEndpoint,
		formatLatencyNs,
		stateColorClass,
		stateLabel,
		attemptsSummary,
		primaryTime
	} from '$lib/utils/dns/dnsFormat';
	import { severityColorClass, severityIcon } from '$lib/utils/dns/dnsSeverity';
	import { formatRfc3339Time } from '$lib/utils/time';
	import type { DnsTransaction } from '$lib/utils/dns/dnsTypes';
	import { t } from '$lib/i18n/index.svelte';

	type Props = VisualizerPluginProps;

	let {
		ds,
		events,
		snapshotData,
		eventVersion = 0,
		isRunning = true,
		isActiveTab = true
	}: Props = $props();

	const dnsConfig = $derived(extractDnsConfig(ds));
	const timeoutMs = $derived(extractDnsResponseTimeoutMs(ds));
	const viewConfig = $derived(extractDnsViewConfig(ds));

	const correlation = createDnsCorrelation({
		getEvents: () => snapshotData ?? events?.toArray() ?? [],
		getConfig: () => dnsConfig,
		getTimeoutMs: () => timeoutMs,
		getVersion: () => eventVersion,
		getIsRunning: () => isRunning,
		getIsActiveTab: () => isActiveTab
	});

	/** Empty string sentinel for "All namespaces" (Select works with plain strings). */
	let namespaceFilter = $state('');
	let issuesOnly = $state(untrack(() => extractDnsViewConfig(ds).issuesOnly));

	let selectedTransactionIds = $state<string[]>([]);
	let selectedTransactionTitle = $state<string>();
	let modalOpen = $state(false);

	function openTransactions(transactionIds: string[], title?: string) {
		selectedTransactionIds = transactionIds;
		selectedTransactionTitle = title;
		modalOpen = true;
	}

	// Namespace filtering scopes transactions BEFORE aggregation, so counts
	// always reflect only in-scope data ("honest filtering" - never a
	// subset that silently changes totals shown elsewhere).
	const scopedTransactions = $derived(
		filterTransactionsByNamespace(correlation.transactions, namespaceFilter || null)
	);
	const fullModel = $derived(buildDnsMapModel(scopedTransactions, timeoutMs));

	// Filter options must reflect the full topology, not the scoped model,
	// so selecting one namespace never hides the selector.
	const namespaces = $derived(extractDnsMapNamespaces(correlation.transactions));

	// "Issues only" is a post-aggregation *visibility* filter: it hides
	// healthy and informational edges (and then any node/group left with nothing to show),
	// but never recomputes or hides any of the counts themselves.
	const displayModel = $derived(issuesOnly ? filterDnsMapModelIssuesOnly(fullModel) : fullModel);

	// Dagre layout is the expensive part of rendering the map, and live
	// traffic can deliver dozens of event batches per second - re-running
	// it on every batch even when the topology (which workloads/resolvers/
	// edges exist) hasn't changed would be wasted work for no visible
	// benefit (positions wouldn't move). `cachedTopologyKey`/`cachedLayout`
	// are deliberately plain (non-`$state`) variables, not reactive
	// themselves, so reading/writing them inside `$derived.by` below never
	// creates a tracked self-dependency (unlike `$state`, which risks
	// exactly the kind of self-retriggering loop fixed in
	// useDnsCorrelation.svelte.ts) - this mirrors the same non-reactive
	// memoization pattern already used for layout bookkeeping elsewhere in
	// this plugin (see the historical drag-position tracking this replaced).
	let cachedTopologyKey: string | undefined;
	let cachedLayout: DnsMapLayout | undefined;

	const graph = $derived.by(() => {
		const topologyKey = dnsMapTopologyKey(displayModel);
		if (cachedLayout && cachedTopologyKey === topologyKey) {
			cachedLayout = refreshDnsMapLayoutData(cachedLayout, displayModel, openTransactions);
		} else {
			cachedLayout = layoutDnsMapModel(displayModel, openTransactions);
			cachedTopologyKey = topologyKey;
		}
		return cachedLayout;
	});

	const namespaceOptions = $derived(namespaces.map((ns) => ({ value: ns, label: ns })));
	const showNamespaceSelect = $derived(showDnsNamespaceSelector(viewConfig, namespaces.length));

	const transactionsById = $derived(
		new Map<string, DnsTransaction>(scopedTransactions.map((t) => [t.id, t]))
	);
	const modalTransactions = $derived(
		selectedTransactionIds.map((id) => transactionsById.get(id)).filter(Boolean) as DnsTransaction[]
	);
	const modalTitle = $derived(
		(() => {
			if (modalTransactions.length === 0) return t('DNS transactions');
			const count = t('{{count}} DNS transactions', { count: modalTransactions.length });
			if (selectedTransactionTitle) return `${selectedTransactionTitle} \u2014 ${count}`;
			const requester = formatEndpoint(modalTransactions[0].requester);
			const nameserver = formatEndpoint(modalTransactions[0].nameserver);
			const oneRequester = modalTransactions.every(
				(txn) => formatEndpoint(txn.requester) === requester
			);
			const oneNameserver = modalTransactions.every(
				(txn) => formatEndpoint(txn.nameserver) === nameserver
			);
			if (oneRequester && oneNameserver) return `${requester} \u2192 ${nameserver}`;
			if (oneRequester) return `${requester} \u2192 ${count}`;
			if (oneNameserver) return `${count} \u2192 ${nameserver}`;
			return count;
		})()
	);

	const workloadCount = $derived(displayModel.workloads.length);
	const resolverCount = $derived(displayModel.resolvers.length);

	const hasAnyData = $derived(fullModel.workloads.length > 0);
	const hasVisibleData = $derived(displayModel.workloads.length > 0);
</script>

<div class="flex h-full w-full flex-col">
	{#if !dnsConfig}
		<div class="flex h-full items-center justify-center text-ig-text-muted">
			<div class="text-center">
				<p class="text-lg">{t('DNS network not available')}</p>
				<p class="mt-2 text-sm">
					{t("This datasource doesn't have the trace_dns field signature")}
				</p>
			</div>
		</div>
	{:else if !hasAnyData}
		<div class="flex h-full items-center justify-center text-ig-text-muted">
			<div class="text-center">
				<p class="text-lg">{t('Waiting for DNS traffic...')}</p>
			</div>
		</div>
	{:else}
		<div
			class="flex flex-wrap items-center justify-between gap-2 border-b border-ig-border bg-ig-surface-raised px-3 py-1.5 text-xs text-ig-text-muted"
		>
			<div class="flex items-center gap-3">
				<span
					>{t('{{count}} workload', { count: workloadCount })}, {t('{{count}} resolver', {
						count: resolverCount
					})}, {t('{{count}} pending', { count: correlation.pendingCount })}</span
				>
			</div>

			<div class="flex items-center gap-2">
				<!-- Compact legend: severity is always icon + text, never color alone. -->
				<div class="hidden items-center gap-2 sm:flex">
					<span class="flex items-center gap-1 {severityColorClass('error')}"
						>{severityIcon('error')} {t('Error')}</span
					>
					<span class="flex items-center gap-1 {severityColorClass('warning')}"
						>{severityIcon('warning')} {t('Warning')}</span
					>
					<span
						class="flex items-center gap-1 {severityColorClass('info')}"
						title={t('NXDOMAIN, orphan response, or ambiguous mDNS/multicast traffic')}
						>{severityIcon('info')} {t('NXDOMAIN')}</span
					>
					<span class="flex items-center gap-1 {severityColorClass('healthy')}"
						>{severityIcon('healthy')} {t('Healthy')}</span
					>
				</div>

				{#if showNamespaceSelect}
					<Select
						bind:value={namespaceFilter}
						options={[{ value: '', label: t('All namespaces') }, ...namespaceOptions]}
						class="!py-1 !text-xs"
						ariaLabel={t('Filter DNS map by namespace')}
					/>
				{/if}

				<button
					type="button"
					class="rounded-ig-sm border px-2 py-1 text-xs font-medium transition-colors"
					class:border-ig-primary={issuesOnly}
					class:bg-ig-primary={issuesOnly}
					class:text-ig-text-on-primary={issuesOnly}
					class:border-ig-border-strong={!issuesOnly}
					class:text-ig-text-secondary={!issuesOnly}
					aria-pressed={issuesOnly}
					onclick={() => (issuesOnly = !issuesOnly)}
				>
					{t('Issues only')}
				</button>
			</div>
		</div>

		<div class="relative flex-1">
			{#if !hasVisibleData}
				<div class="flex h-full items-center justify-center text-ig-text-muted">
					<p class="text-sm">{t('No DNS issues in the retained window')}</p>
				</div>
			{:else}
				<!--
					Re-mount on namespace/issues-filter changes so `fitView`
					re-applies to the new (possibly repositioned/smaller) node
					set - XYFlow only auto-fits on a component's initial mount,
					not on every nodes/edges prop change.
				-->
				{#key `${namespaceFilter}\u0001${issuesOnly}`}
					<DnsNetworkChart nodes={graph.nodes} edges={graph.edges} />
				{/key}
			{/if}
		</div>
	{/if}
</div>

<BaseModal bind:open={modalOpen} title={modalTitle} size="lg">
	<div class="max-h-[60vh] overflow-auto">
		<table class="w-max min-w-full whitespace-nowrap text-xs">
			<thead class="sticky top-0 bg-ig-surface">
				<tr class="text-left text-ig-text-secondary">
					<th class="border-b border-ig-border px-2 py-1 font-normal uppercase">{t('Time')}</th>
					<th class="border-b border-ig-border px-2 py-1 font-normal uppercase">{t('Name')}</th>
					<th class="border-b border-ig-border px-2 py-1 font-normal uppercase">{t('Type')}</th>
					<th class="border-b border-ig-border px-2 py-1 font-normal uppercase">{t('Attempts')}</th>
					<th class="border-b border-ig-border px-2 py-1 font-normal uppercase">{t('State')}</th>
					<th class="border-b border-ig-border px-2 py-1 text-right font-normal uppercase"
						>{t('Latency')}</th
					>
					<th class="border-b border-ig-border px-2 py-1 font-normal uppercase">{t('RCode')}</th>
					<th class="border-b border-ig-border px-2 py-1 font-normal uppercase">{t('Answers')}</th>
				</tr>
			</thead>
			<tbody>
				{#each modalTransactions as txn (txn.id)}
					<tr class="hover:bg-ig-surface-raised">
						<td class="border-b border-ig-border px-2 py-1 font-mono text-ig-text">
							{formatRfc3339Time(primaryTime(txn))}
						</td>
						<td class="border-b border-ig-border px-2 py-1 font-mono text-ig-text">
							{txn.name}
						</td>
						<td class="border-b border-ig-border px-2 py-1 font-mono text-ig-text">{txn.qtype}</td>
						<td class="border-b border-ig-border px-2 py-1 font-mono text-ig-text">
							{attemptsSummary(txn, t)}
						</td>
						<td class="border-b border-ig-border px-2 py-1 font-mono {stateColorClass(txn.state)}">
							{t(stateLabel(txn.state))}
						</td>
						<td class="border-b border-ig-border px-2 py-1 text-right font-mono text-ig-text">
							{formatLatencyNs(txn.latencyNs)}
						</td>
						<td class="border-b border-ig-border px-2 py-1 font-mono text-ig-text">
							{txn.rcode ?? ''}
						</td>
						<td class="border-b border-ig-border px-2 py-1 font-mono text-ig-text">
							{txn.answers ?? ''}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</BaseModal>
