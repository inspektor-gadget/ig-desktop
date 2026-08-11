<script lang="ts">
	import VirtualTableBody from '$lib/components/VirtualTable/VirtualTableBody.svelte';
	import type { VisualizerPluginProps } from '$lib/types/plugin-api';
	import type { VirtualTableColumn } from '$lib/components/VirtualTable/types';
	import { extractDnsConfig, extractDnsResponseTimeoutMs } from '$lib/utils/dns/dnsConfig';
	import { createDnsCorrelation } from '$lib/utils/dns/useDnsCorrelation.svelte';
	import {
		formatDnsEndpointIdentity,
		formatLatencyNs,
		stateColorClass,
		stateLabel,
		attemptsSummary,
		primaryTime
	} from '$lib/utils/dns/dnsFormat';
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
	let showRawEndpoints = $state(false);

	const correlation = createDnsCorrelation({
		getEvents: () => snapshotData ?? events?.toArray() ?? [],
		getConfig: () => dnsConfig,
		getTimeoutMs: () => timeoutMs,
		getVersion: () => eventVersion,
		getIsRunning: () => isRunning,
		getIsActiveTab: () => isActiveTab
	});

	// $derived (not a plain const) so column labels re-translate when the
	// active language changes, matching the table visualizer's convention.
	const columns = $derived<VirtualTableColumn[]>([
		{ key: 'time', label: t('Time'), width: 20 },
		{ key: 'requester', label: t('Requester'), width: 34 },
		{ key: 'nameserver', label: t('Resolver'), width: 28 },
		{ key: 'name', label: t('Name'), width: 28 },
		{ key: 'qtype', label: t('Type'), width: 8 },
		{ key: 'attempts', label: t('Attempts'), width: 14 },
		{ key: 'state', label: t('State'), width: 14 },
		{ key: 'latency', label: t('Latency'), width: 10, align: 'right' },
		{ key: 'rcode', label: t('RCode'), width: 12 },
		{ key: 'answers', label: t('Answers'), width: 26 }
	]);
</script>

<div class="flex h-full w-full flex-col">
	{#if !dnsConfig}
		<div class="flex h-full items-center justify-center text-ig-text-muted">
			<div class="text-center">
				<p class="text-lg">{t('DNS transactions not available')}</p>
				<p class="mt-2 text-sm">
					{t("This datasource doesn't have the trace_dns field signature")}
				</p>
			</div>
		</div>
	{:else}
		<div
			class="flex items-center justify-between border-b border-ig-border bg-ig-surface-raised px-3 py-1.5 text-xs text-ig-text-muted"
		>
			<span>{t('{{count}} transaction', { count: correlation.transactions.length })}</span>
			<div class="flex items-center gap-4">
				<label class="flex cursor-pointer items-center gap-1.5">
					<input
						type="checkbox"
						bind:checked={showRawEndpoints}
						class="rounded-ig-sm border-ig-border-strong bg-ig-surface-raised text-ig-primary focus:ring-ig-primary-muted focus:ring-offset-0"
					/>
					{t('Show raw IPs')}
				</label>
				<span>{t('{{count}} pending', { count: correlation.pendingCount })}</span>
			</div>
		</div>

		<div class="flex-1 overflow-hidden">
			{#if correlation.transactions.length === 0}
				<div class="flex h-full items-center justify-center text-ig-text-muted">
					<p class="text-sm">{t('Waiting for DNS traffic...')}</p>
				</div>
			{:else}
				<VirtualTableBody items={correlation.transactions} {columns} rowHeight={24} class="text-sm">
					{#snippet header(
						headerColumns,
						{ startResize, resizingIndex, setHeaderRow, resetColumnWidth }
					)}
						<tr class="bg-ig-surface" use:setHeaderRow aria-label={t('Column headers')}>
							{#each headerColumns as column, i (column.key)}
								<th
									scope="col"
									aria-label={column.label}
									class="relative overflow-hidden border-r border-r-ig-border p-2 text-xs font-normal select-none last:border-r-0"
								>
									<div class="overflow-hidden text-ellipsis whitespace-nowrap uppercase">
										{column.label}
									</div>
									<div
										class="resize-handle"
										class:active={resizingIndex === i}
										role="separator"
										aria-orientation="vertical"
										aria-label={t('Resize column {{field}}', { field: column.label })}
										onpointerdown={(e) => startResize(e, i)}
										oncontextmenu={(e) => {
											e.preventDefault();
											resetColumnWidth(i);
										}}
									></div>
								</th>
							{/each}
						</tr>
					{/snippet}
					{#snippet row(txn: DnsTransaction)}
						<td class="border-r border-r-ig-border px-2 py-0 font-mono text-xs text-ig-text">
							{formatRfc3339Time(primaryTime(txn))}
						</td>
						<td class="border-r border-r-ig-border px-2 py-0 font-mono text-xs text-ig-text">
							{formatDnsEndpointIdentity(
								txn.requester,
								txn.requesterMeta,
								txn.requesterK8s,
								showRawEndpoints
							)}
						</td>
						<td class="border-r border-r-ig-border px-2 py-0 font-mono text-xs text-ig-text">
							{formatDnsEndpointIdentity(
								txn.nameserver,
								txn.resolverMeta,
								txn.resolverK8s,
								showRawEndpoints
							)}
						</td>
						<td
							class="border-r border-r-ig-border px-2 py-0 font-mono text-xs text-ig-text overflow-hidden text-ellipsis text-nowrap"
							title={txn.name}
						>
							{txn.name}
						</td>
						<td class="border-r border-r-ig-border px-2 py-0 font-mono text-xs text-ig-text">
							{txn.qtype}
						</td>
						<td class="border-r border-r-ig-border px-2 py-0 font-mono text-xs text-ig-text">
							{attemptsSummary(txn, t)}
						</td>
						<td
							class="border-r border-r-ig-border px-2 py-0 font-mono text-xs {stateColorClass(
								txn.state
							)}"
						>
							{t(stateLabel(txn.state))}
						</td>
						<td
							class="border-r border-r-ig-border px-2 py-0 text-right font-mono text-xs text-ig-text"
						>
							{formatLatencyNs(txn.latencyNs)}
						</td>
						<td class="border-r border-r-ig-border px-2 py-0 font-mono text-xs text-ig-text">
							{txn.rcode ?? ''}
						</td>
						<td
							class="px-2 py-0 font-mono text-xs text-ig-text overflow-hidden text-ellipsis text-nowrap"
							title={txn.answers}
						>
							{txn.answers ?? ''}
						</td>
					{/snippet}
				</VirtualTableBody>
			{/if}
		</div>
	{/if}
</div>
