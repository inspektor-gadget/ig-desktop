<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { DnsResolverNodeData } from '$lib/utils/dns/dnsMapGraph';
	import { severityColorClass, severityIcon, severityLabel } from '$lib/utils/dns/dnsSeverity';
	import { formatEndpoint } from '$lib/utils/dns/dnsFormat';
	import { t } from '$lib/i18n/index.svelte';

	interface Props {
		data: DnsResolverNodeData;
		selected?: boolean;
	}
	let { data, selected = false }: Props = $props();

	const resolver = $derived(data.resolver);
	const borderClass = $derived(selected ? 'border-ig-primary' : 'border-ig-border-strong');

	/** Authoritative enrichment when known (e.g. "svc kube-dns"), otherwise plain IP:port - never guessed. */
	const label = $derived(
		resolver.k8s ? `${resolver.k8s.kind} ${resolver.k8s.name}` : formatEndpoint(resolver)
	);
	const subtitle = $derived(
		resolver.k8s ? (resolver.k8s.namespace ?? formatEndpoint(resolver)) : undefined
	);

	/** Accessible summary: identity + query count + severity, not just title/color. */
	const ariaSummary = $derived(
		`${label}, ${t('{{count}} query', { count: resolver.counts.total })}, ${t(severityLabel(resolver.counts.severity))}`
	);
</script>

<div
	class="dns-resolver-node rounded-ig-md border-2 border-dashed bg-ig-surface-raised px-3 py-2 shadow-sm transition-colors {borderClass}"
	role="group"
	aria-label={ariaSummary}
>
	<div class="flex items-start justify-between gap-2">
		<span class="truncate text-xs font-semibold text-ig-text" title={label}>{label}</span>
		<span
			class="flex shrink-0 items-center gap-0.5 text-xs font-semibold {severityColorClass(
				resolver.counts.severity
			)}"
			title={t(severityLabel(resolver.counts.severity))}
		>
			{severityIcon(resolver.counts.severity)}
		</span>
	</div>

	{#if subtitle}
		<div class="mt-0.5 truncate font-mono text-[10px] text-ig-text-muted" title={subtitle}>
			{subtitle}
		</div>
	{/if}

	<button
		type="button"
		class="mt-1.5 text-[10px] text-ig-primary hover:underline"
		aria-label={t('{{count}} DNS transactions, press Enter for details', {
			count: resolver.counts.total
		})}
		onclick={() => data.onOpen(resolver.transactionIds, label)}
	>
		{t('{{count}} query', { count: resolver.counts.total })}
	</button>

	<Handle type="target" position={Position.Left} />
	<Handle type="source" position={Position.Right} />
</div>

<style>
	.dns-resolver-node {
		width: 200px;
		min-height: 84px;
	}
</style>
