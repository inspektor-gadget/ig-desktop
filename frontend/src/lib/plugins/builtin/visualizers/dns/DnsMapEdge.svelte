<script lang="ts">
	import { BaseEdge, EdgeLabel, getBezierPath, type EdgeProps } from '@xyflow/svelte';
	import type { DnsMapEdgeData } from '$lib/utils/dns/dnsMapGraph';
	import { formatLatencyNs, stateColorClass, stateLabel } from '$lib/utils/dns/dnsFormat';
	import {
		primarySeverityReason,
		severityCardClass,
		severityColorClass,
		severityEdgeClass,
		severityIcon,
		severityLabel
	} from '$lib/utils/dns/dnsSeverity';
	import { t } from '$lib/i18n/index.svelte';

	// `data` is typed as optional and read defensively below: SvelteFlow's
	// generic edge props don't statically guarantee our custom edge data
	// shape actually arrives intact (e.g. a malformed/partial edge slipping
	// through), so a missing/malformed `data` must degrade gracefully
	// instead of throwing during render.
	type Props = EdgeProps & { data?: Partial<DnsMapEdgeData> };

	let { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: Props =
		$props();

	const [directPath, directLabelX, directLabelY] = $derived(
		getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
	);
	const labelX = $derived(data?.labelX ?? directLabelX);
	const labelY = $derived(data?.labelY ?? directLabelY);
	const path = $derived(
		data?.labelX === undefined || data?.labelY === undefined
			? directPath
			: `M${sourceX},${sourceY} C${(sourceX + labelX) / 2},${sourceY} ${(sourceX + labelX) / 2},${labelY} ${labelX},${labelY} C${(labelX + targetX) / 2},${labelY} ${(labelX + targetX) / 2},${targetY} ${targetX},${targetY}`
	);

	const edge = $derived(data?.edge);
	const counts = $derived(edge?.counts);
	const preview = $derived(edge?.preview ?? []);
	const reason = $derived(counts ? primarySeverityReason(counts) : undefined);
	const reasonDimensionCount = $derived(
		counts
			? [
					counts.serverErrorCount,
					counts.timeoutCount,
					counts.nxdomainCount,
					counts.retryingCount,
					counts.lateCount,
					counts.slowCount
				].filter((count) => count > 0).length
			: 0
	);

	function open() {
		if (edge) data?.onOpen?.(edge.transactionIds);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open();
		}
	}

	const accessibleSummary = $derived(
		counts
			? t('{{count}} DNS transactions, severity {{severity}}, press Enter for details', {
					count: counts.total,
					severity: t(severityLabel(counts.severity))
				})
			: t('DNS transactions, press Enter for details')
	);

	// Encode the aggregate severity on the edge path itself (not just the
	// card) so at-a-glance triage works even before opening/hovering a
	// card - severity is still never conveyed by color alone (see the icon
	// + text in the card below).
	const edgePathClass = $derived(counts ? severityEdgeClass(counts.severity) : '');
	// Same idea for the card's own surface: a severity-tinted background
	// (see the color-mix() rules below), not just colored text, so the
	// card reads as error/warning/etc. at a glance even at the small sizes
	// this map renders cards at.
	const edgeCardClass = $derived(counts ? severityCardClass(counts.severity) : '');
</script>

<BaseEdge {path} class={edgePathClass} />

<EdgeLabel x={labelX} y={labelY} transparent>
	<!--
		Resting state is compact (~140px, icon + severity + total + one
		concise reason) so a full row of edges doesn't occlude each other's
		severity - the old fixed 240px card routinely covered a neighbor's
		icon/reason in a dense view. Secondary reason breakdown + the
		failure-prioritized transaction preview only appear expanded, on
		hover or keyboard focus, raised above sibling edge labels via
		z-index so the expansion never gets occluded in turn. The
		transition is a single trivial width tween, disabled entirely under
		prefers-reduced-motion.
	-->
	<div
		class="dns-map-edge-card group w-36 overflow-hidden rounded-ig-md border border-ig-border bg-ig-surface text-xs shadow-md transition-[width] duration-150 motion-reduce:transition-none hover:w-60 hover:shadow-lg focus:w-60 focus:shadow-lg {edgeCardClass}"
		role="button"
		tabindex="0"
		aria-label={accessibleSummary}
		onclick={open}
		onkeydown={onKeydown}
	>
		<div
			class="dns-map-edge-card-header flex items-center justify-between gap-1 border-b border-ig-border px-2 py-1 font-semibold"
		>
			<span
				class="flex min-w-0 items-center gap-1 truncate {counts
					? severityColorClass(counts.severity)
					: ''}"
			>
				{#if counts}
					<span aria-hidden="true">{severityIcon(counts.severity)}</span>
					<span class="truncate">{t(severityLabel(counts.severity))}</span>
				{/if}
			</span>
			<span class="shrink-0 text-ig-text-muted"
				>{t('{{count}} total', { count: counts?.total ?? 0 })}</span
			>
		</div>

		<!--
			Always shown (regardless of severity/reason) so the click-through
			affordance is obvious at rest, not just discoverable via hover -
			one compact line, so healthy edges (which have no `reason`) only
			gain a single extra row and non-healthy edges gain none (the hint
			shares the reason's existing row).
		-->
		<div class="flex items-center justify-between gap-1 px-2 py-1 text-[10px]">
			{#if reason}
				<span class="truncate {counts ? severityColorClass(counts.severity) : ''}">
					{t(reason.labelKey, { count: reason.count })}
				</span>
			{:else}
				<span></span>
			{/if}
			<span
				class="shrink-0 text-ig-text-muted group-hover:text-ig-primary group-focus:text-ig-primary"
				>{t('View queries →')}</span
			>
		</div>

		<!-- Expanded-only content: not rendered at rest, revealed on hover/focus. -->
		<div class="dns-map-edge-expanded hidden group-hover:block group-focus:block">
			{#if counts && reasonDimensionCount > 1}
				<div
					class="flex flex-wrap gap-x-2 gap-y-0.5 border-t border-b border-ig-border px-2 py-1 text-[10px] text-ig-text-muted"
				>
					{#if counts.timeoutCount > 0 && reason?.labelKey !== '{{count}} timeout'}<span
							class="text-ig-error">{t('{{count}} timeout', { count: counts.timeoutCount })}</span
						>{/if}
					{#if counts.serverErrorCount > 0 && reason?.labelKey !== '{{count}} server error'}<span
							class="text-ig-error"
							>{t('{{count}} server error', { count: counts.serverErrorCount })}</span
						>{/if}
					{#if counts.nxdomainCount > 0 && reason?.labelKey !== '{{count}} NXDOMAIN'}<span
							class="text-ig-text-muted"
							>{t('{{count}} NXDOMAIN', { count: counts.nxdomainCount })}</span
						>{/if}
					{#if counts.retryingCount > 0 && reason?.labelKey !== '{{count}} retrying'}<span
							class="text-ig-warning"
							>{t('{{count}} retrying', { count: counts.retryingCount })}</span
						>{/if}
					{#if counts.lateCount > 0 && reason?.labelKey !== '{{count}} late'}<span
							class="text-ig-warning">{t('{{count}} late', { count: counts.lateCount })}</span
						>{/if}
					{#if counts.slowCount > 0 && reason?.labelKey !== '{{count}} slow'}<span
							class="text-ig-warning">{t('{{count}} slow', { count: counts.slowCount })}</span
						>{/if}
				</div>
			{/if}

			<ul class="max-h-40 divide-y divide-ig-border overflow-hidden">
				{#each preview as txn (txn.id)}
					<li class="flex items-center justify-between gap-2 px-2 py-1">
						<span class="truncate font-mono text-ig-text" title="{txn.name} ({txn.qtype})">
							{txn.name}
						</span>
						<span class="flex shrink-0 items-center gap-1 {stateColorClass(txn.state)}">
							{#if txn.latencyNs !== undefined}
								<span class="text-ig-text-muted">{formatLatencyNs(txn.latencyNs)}</span>
							{/if}
							<span title={t(stateLabel(txn.state))}>●</span>
						</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</EdgeLabel>

<style>
	.dns-map-edge-card {
		cursor: pointer;
	}

	/*
		Severity-tinted surfaces: color-mix() the same semantic --ig-color-*
		variable severityColorClass/severityEdgeClass already use into
		--ig-color-surface, so a card's severity reads from its background
		at a glance (not just its icon/text color) - no raw color values,
		no hardcoded white/high-contrast surface, and still fully
		theme-aware (the mix recomputes whenever --ig-color-surface changes
		between light/dark). The header gets a stronger tint than the body
		so it reads as a distinct title bar, matching the original
		bg-ig-surface-raised affordance it replaces. Selector specificity
		(class + class) intentionally beats the plain bg-ig-surface /
		border-ig-border Tailwind utilities still present in markup as the
		no-severity fallback.
	*/
	.dns-map-edge-card.dns-map-edge-card--error {
		background-color: color-mix(in srgb, var(--ig-color-error) 12%, var(--ig-color-surface));
		border-color: color-mix(in srgb, var(--ig-color-error) 45%, var(--ig-color-border));
	}
	.dns-map-edge-card.dns-map-edge-card--warning {
		background-color: color-mix(in srgb, var(--ig-color-warning) 12%, var(--ig-color-surface));
		border-color: color-mix(in srgb, var(--ig-color-warning) 45%, var(--ig-color-border));
	}
	.dns-map-edge-card.dns-map-edge-card--info {
		background-color: color-mix(in srgb, var(--ig-color-text-muted) 10%, var(--ig-color-surface));
		border-color: color-mix(in srgb, var(--ig-color-text-muted) 35%, var(--ig-color-border));
	}
	.dns-map-edge-card.dns-map-edge-card--healthy {
		background-color: color-mix(in srgb, var(--ig-color-success) 10%, var(--ig-color-surface));
		border-color: color-mix(in srgb, var(--ig-color-success) 35%, var(--ig-color-border));
	}

	.dns-map-edge-card--error .dns-map-edge-card-header {
		background-color: color-mix(in srgb, var(--ig-color-error) 22%, var(--ig-color-surface));
	}
	.dns-map-edge-card--warning .dns-map-edge-card-header {
		background-color: color-mix(in srgb, var(--ig-color-warning) 22%, var(--ig-color-surface));
	}
	.dns-map-edge-card--info .dns-map-edge-card-header {
		background-color: color-mix(in srgb, var(--ig-color-text-muted) 18%, var(--ig-color-surface));
	}
	.dns-map-edge-card--healthy .dns-map-edge-card-header {
		background-color: color-mix(in srgb, var(--ig-color-success) 18%, var(--ig-color-surface));
	}

	.dns-map-edge-card:hover,
	.dns-map-edge-card:focus-visible {
		border-color: var(--ig-color-primary, #3b82f6);
	}

	.dns-map-edge-card:focus-visible {
		outline: 2px solid var(--ig-color-primary, #3b82f6);
		outline-offset: 1px;
	}

	/*
		All edge labels are portaled siblings in one shared layer (see
		@xyflow/svelte's EdgeLabel), each its own stacking context (it sets
		`transform` unconditionally). Raising z-index on our own card alone
		can't lift it above a *different* edge's label stacking context -
		the label wrapper itself needs the higher z-index so the expanded
		card actually renders above neighboring edges instead of getting
		clipped beneath them. `!important` is required because XYFlow sets
		an inline `z-index: 0` style on every `.svelte-flow__edge-label`,
		which otherwise always wins over this class-based rule.
	*/
	:global(.svelte-flow__edge-label:has(.dns-map-edge-card:hover)),
	:global(.svelte-flow__edge-label:has(.dns-map-edge-card:focus-within)) {
		z-index: 1000 !important;
	}
</style>
