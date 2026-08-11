<script lang="ts">
	import { SvelteFlow, Controls, Background, MiniMap } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { untrack } from 'svelte';
	import AddressNode from './AddressNode.svelte';
	import NamespaceGroupNode from './NamespaceGroupNode.svelte';
	import type { NetworkNode, NetworkEdge, NetworkNamespaceGroupNode } from '$lib/types/networkmap';
	import { layoutNetworkMap, networkMapTopologyKey } from '$lib/utils/networkMapLayout';
	import { t } from '$lib/i18n/index.svelte';

	interface Props {
		nodes: NetworkNode[];
		edges: NetworkEdge[];
	}

	let { nodes, edges }: Props = $props();

	// XYFlow's NodeTypes type is complex - using type assertion for compatibility
	const nodeTypes = {
		address: AddressNode,
		networkNamespaceGroup: NamespaceGroupNode
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as Record<string, any>;

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Intentional: drag positions don't drive reactivity
	let userPositions: Map<string, { x: number; y: number }> = new Map();
	let topologyKey = '';

	// Track layouted nodes in state
	let layoutedNodes = $state<(NetworkNode | NetworkNamespaceGroupNode)[]>([]);

	// Handle node drag end - save user position
	function handleNodeDragStop({
		targetNode
	}: {
		targetNode: NetworkNode | NetworkNamespaceGroupNode | null;
	}) {
		if (targetNode?.type === 'address') {
			userPositions.set(targetNode.id, {
				x: targetNode.position.x,
				y: targetNode.position.y
			});
		}
	}

	// Layout nodes when input changes
	$effect(() => {
		if (nodes.length === 0) {
			layoutedNodes = [];
			userPositions.clear();
			topologyKey = '';
			return;
		}

		const nextTopologyKey = networkMapTopologyKey(nodes);
		if (nextTopologyKey !== topologyKey) {
			const currentIds = new Set(nodes.map((node) => node.id));
			for (const id of userPositions.keys()) {
				if (!currentIds.has(id)) userPositions.delete(id);
			}
			const layout = layoutNetworkMap(nodes, edges);
			layoutedNodes = layout.nodes.map((node) => {
				const userPosition = userPositions.get(node.id);
				return userPosition ? { ...node, position: userPosition } : node;
			});
			topologyKey = nextTopologyKey;
			return;
		}

		const currentNodes = new Map(nodes.map((node) => [node.id, node]));
		const previousNodes = untrack(() => layoutedNodes);
		layoutedNodes = previousNodes.map((node) => {
			const current = currentNodes.get(node.id);
			const refreshed = current ? { ...node, data: current.data } : node;
			const userPosition = userPositions.get(node.id);
			return userPosition ? { ...refreshed, position: userPosition } : refreshed;
		});
	});

	// Stats for overlay
	const nodeCount = $derived(nodes.length);
	const edgeCount = $derived(edges.length);

	// Apply class to edges based on activity state
	const styledEdges = $derived(
		edges.map((edge) => ({
			...edge,
			class: edge.data?.isActive ? 'active' : ''
		}))
	);
</script>

<div class="network-map-container h-full w-full relative">
	<SvelteFlow
		nodes={layoutedNodes}
		edges={styledEdges}
		{nodeTypes}
		fitView
		fitViewOptions={{ padding: 0.2 }}
		minZoom={0.1}
		maxZoom={2}
		defaultEdgeOptions={{
			type: 'default',
			animated: false
		}}
		class="!bg-transparent"
		nodesConnectable={false}
		onnodedragstop={handleNodeDragStop}
	>
		<Controls position="bottom-right" />
		<Background />
		<MiniMap
			position="bottom-left"
			pannable
			zoomable
			nodeColor={(node) => (node.type === 'networkNamespaceGroup' ? 'transparent' : '#9ca3af')}
		/>
	</SvelteFlow>

	<!-- Stats overlay -->
	<div
		class="absolute top-2 left-2 text-xs text-gray-500 dark:text-gray-400 bg-white/90 dark:bg-gray-800/90 px-2 py-1 rounded-ig-sm pointer-events-none z-10"
	>
		{t('{{count}} node', { count: nodeCount })}, {t('{{count}} connection', { count: edgeCount })}
	</div>
</div>

<style>
	/* Edge styling */
	:global(.svelte-flow__edge path) {
		stroke: #9ca3af;
		stroke-width: 2px;
		transition:
			stroke 0.3s ease,
			stroke-width 0.3s ease;
	}

	/* Wider invisible hit area for edge hover/click */
	:global(.svelte-flow__edge) {
		cursor: pointer;
	}

	:global(.svelte-flow__edge path.svelte-flow__edge-interaction) {
		stroke-width: 20px;
	}

	:global(.dark .svelte-flow__edge path) {
		stroke: #6b7280;
	}

	/* Hover edge styling */
	:global(.svelte-flow__edge:hover path:not(.svelte-flow__edge-interaction)) {
		stroke: #3b82f6;
		stroke-width: 3px;
	}

	:global(.dark .svelte-flow__edge:hover path:not(.svelte-flow__edge-interaction)) {
		stroke: #60a5fa;
	}

	/* Active edge animation - has priority over hover */
	:global(.svelte-flow__edge.active path:not(.svelte-flow__edge-interaction)) {
		stroke: #22c55e !important;
		stroke-width: 4px !important;
	}

	/* MiniMap styling */
	:global(.svelte-flow__minimap) {
		background: rgba(255, 255, 255, 0.9) !important;
		border-radius: 4px;
	}

	:global(.dark .svelte-flow__minimap) {
		background: rgba(31, 41, 55, 0.9) !important;
	}

	/* Controls styling */
	:global(.svelte-flow__controls) {
		background: rgba(255, 255, 255, 0.9);
		border-radius: 4px;
	}

	:global(.dark .svelte-flow__controls) {
		background: rgba(31, 41, 55, 0.9);
	}

	:global(.dark .svelte-flow__controls button) {
		background: #374151;
		color: #f3f4f6;
		border-color: #4b5563;
	}

	:global(.dark .svelte-flow__controls button:hover) {
		background: #4b5563;
	}

	/* Transparent background - inherits from parent */
	:global(.svelte-flow__background) {
		background-color: transparent !important;
	}

	/* Subtle dot pattern */
	:global(.svelte-flow__background pattern circle) {
		fill: #d1d5db;
	}

	:global(.dark .svelte-flow__background pattern circle) {
		fill: #374151;
	}
</style>
