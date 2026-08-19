<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { DnsWorkloadNodeData } from '$lib/utils/dns/dnsMapGraph';
	import { severityColorClass, severityIcon, severityLabel } from '$lib/utils/dns/dnsSeverity';
	import { t } from '$lib/i18n/index.svelte';

	interface Props {
		data: DnsWorkloadNodeData;
		selected?: boolean;
	}
	let { data, selected = false }: Props = $props();

	const workload = $derived(data.workload);
	const borderClass = $derived(selected ? 'border-ig-primary' : 'border-ig-border-strong');

	/** Primary label: pod name -> container/runtime name -> netns -> first address. */
	const label = $derived(
		workload.podName ??
			workload.runtimeContainerName ??
			workload.runtimeContainerId ??
			(workload.netnsId ? `netns ${workload.netnsId}` : undefined) ??
			workload.addresses[0] ??
			t('Unknown workload')
	);

	const extraAddresses = $derived(Math.max(0, workload.addresses.length - 1));
	const extraContainers = $derived(
		Math.max(0, workload.containerNames.length - (workload.podName ? 1 : 0))
	);

	/** Accessible summary: identity + query count + severity, not just title/color. */
	const ariaSummary = $derived(
		`${label}, ${t('{{count}} query', { count: workload.counts.total })}, ${t(severityLabel(workload.counts.severity))}`
	);
</script>

<div
	class="dns-workload-node rounded-ig-md border-2 bg-ig-surface px-3 py-2 shadow-sm transition-colors {borderClass}"
	role="group"
	aria-label={ariaSummary}
>
	<div class="flex items-start justify-between gap-2">
		<span class="truncate text-xs font-semibold text-ig-text" title={label}>{label}</span>
		<span
			class="flex shrink-0 items-center gap-0.5 text-xs font-semibold {severityColorClass(
				workload.counts.severity
			)}"
			title={t(severityLabel(workload.counts.severity))}
		>
			{severityIcon(workload.counts.severity)}
		</span>
	</div>

	{#if workload.containerNames.length > 0}
		<div
			class="mt-0.5 truncate text-[10px] text-ig-text-muted"
			title={workload.containerNames.join(', ')}
		>
			{workload.containerNames[0]}{#if extraContainers > 0}&nbsp;{t('+{{count}} more', {
					count: extraContainers
				})}{/if}
		</div>
	{/if}

	<div
		class="mt-1 truncate font-mono text-[10px] text-ig-text-muted"
		title={workload.addresses.join(', ')}
	>
		{workload.addresses[0]}{#if extraAddresses > 0}&nbsp;{t('+{{count}} more', {
				count: extraAddresses
			})}{/if}
	</div>

	<div class="mt-1.5 flex items-center justify-between text-[10px] text-ig-text-muted">
		<button
			type="button"
			class="text-ig-primary hover:underline"
			aria-label={t('{{count}} DNS transactions, press Enter for details', {
				count: workload.counts.total
			})}
			onclick={() => data.onOpen(workload.transactionIds, label)}
		>
			{t('{{count}} query', { count: workload.counts.total })}
		</button>
		{#if workload.counts.severity === 'error'}
			<span class={severityColorClass('error')}>
				{t('{{count}} error', { count: workload.counts.errorCount })}
			</span>
		{:else if workload.counts.severity === 'warning'}
			<span class={severityColorClass('warning')}>
				{t('{{count}} warning', { count: workload.counts.warningCount })}
			</span>
		{:else if workload.counts.severity === 'info'}
			<span class={severityColorClass('info')}>
				{#if workload.counts.nxdomainCount === workload.counts.infoCount}
					{t('{{count}} NXDOMAIN', { count: workload.counts.nxdomainCount })}
				{:else}
					{t('{{count}} info', { count: workload.counts.infoCount })}
				{/if}
			</span>
		{/if}
	</div>

	<Handle type="source" position={Position.Right} />
</div>

<style>
	.dns-workload-node {
		width: 220px;
		min-height: 104px;
	}
</style>
