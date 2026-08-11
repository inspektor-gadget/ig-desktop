<script lang="ts">
	import type { DnsNamespaceGroupData } from '$lib/utils/dns/dnsMapGraph';

	interface Props {
		data: DnsNamespaceGroupData;
	}
	let { data }: Props = $props();
</script>

<!--
	Purely a visual grouping frame - namespace groups are nonselectable,
	nondraggable, and nonfocusable (enforced via node flags in
	dnsMapGraph.ts), so this component has no interaction of its own.
-->
<div
	class="dns-namespace-group h-full w-full rounded-ig-lg border-2 border-dashed"
	class:border-ig-border={!data.fallback}
	class:border-ig-text-muted={data.fallback}
>
	<div
		class="dns-namespace-group-label absolute top-1 left-2 rounded-ig-sm bg-ig-surface px-2 py-0.5 text-[11px] font-semibold tracking-wide text-ig-text-secondary uppercase"
	>
		{data.label}
	</div>
</div>

<style>
	.dns-namespace-group {
		background-color: var(--ig-color-surface-raised, rgba(243, 244, 246, 0.35));
		position: relative;
	}
</style>
