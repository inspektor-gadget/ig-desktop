<script lang="ts">
	import { SvelteFlow, Controls, Background, MiniMap } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import WorkloadNode from './WorkloadNode.svelte';
	import ResolverNode from './ResolverNode.svelte';
	import NamespaceGroupNode from './NamespaceGroupNode.svelte';
	import DnsMapEdge from './DnsMapEdge.svelte';
	import type {
		DnsWorkloadNode,
		DnsResolverNode,
		DnsNamespaceGroupNode,
		DnsMapEdge as DnsMapEdgeType
	} from '$lib/utils/dns/dnsMapGraph';

	interface Props {
		nodes: (DnsWorkloadNode | DnsResolverNode | DnsNamespaceGroupNode)[];
		edges: DnsMapEdgeType[];
	}

	let { nodes, edges }: Props = $props();

	const nodeTypes = {
		dnsWorkload: WorkloadNode,
		dnsResolver: ResolverNode,
		dnsNamespaceGroup: NamespaceGroupNode
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as Record<string, any>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const edgeTypes = { dnsMap: DnsMapEdge } as Record<string, any>;
</script>

<!--
	Positions come pre-computed from `layoutDnsMapModel` (a pure function of
	the current transactions) - there is no chart-local layout or drag-
	persistence state here. The map is a derived, read-only view of
	correlated DNS traffic (no concept of the user authoring connections or
	repositioning nodes), so both node dragging and node-to-node connections
	are disabled; a click is a plain (no-op) selection, exactly like any
	other read-only visualizer.
-->
<div class="dns-map-container relative h-full w-full">
	<SvelteFlow
		{nodes}
		{edges}
		{nodeTypes}
		{edgeTypes}
		fitView
		fitViewOptions={{ padding: 0.2, minZoom: 0.75 }}
		minZoom={0.05}
		maxZoom={2}
		defaultEdgeOptions={{ type: 'dnsMap' }}
		class="!bg-transparent"
		nodesDraggable={false}
		nodesConnectable={false}
	>
		<Controls position="bottom-right" />
		<Background />
		<MiniMap position="bottom-left" pannable zoomable />
	</SvelteFlow>
</div>

<style>
	:global(.dns-map-container .svelte-flow__edge path) {
		stroke: var(--ig-color-border-strong, #d1d5db);
		stroke-width: 2px;
	}

	/*
		Aggregate edge severity, encoded directly on the path (not just the
		edge card) so at-a-glance triage works before ever opening/hovering
		a card. Selectors are scoped with the same specificity as the
		default-stroke rule above (one class + element) but declared after
		it, so severity always wins over the default border color; :hover
		still raises it further to the primary accent for the interaction
		affordance.
	*/
	:global(.dns-map-container .svelte-flow__edge path.dns-map-edge-path--error) {
		stroke: var(--ig-color-error, #ef4444);
	}
	:global(.dns-map-container .svelte-flow__edge path.dns-map-edge-path--warning) {
		stroke: var(--ig-color-warning, #eab308);
	}
	:global(.dns-map-container .svelte-flow__edge path.dns-map-edge-path--info) {
		stroke: var(--ig-color-text-muted, #6b7280);
	}
	:global(.dns-map-container .svelte-flow__edge path.dns-map-edge-path--healthy) {
		stroke: var(--ig-color-success, #22c55e);
	}

	:global(.dns-map-container .svelte-flow__edge:hover path) {
		stroke: var(--ig-color-primary, #3b82f6);
	}

	:global(.dns-map-container .svelte-flow__background) {
		background-color: transparent !important;
	}
</style>
