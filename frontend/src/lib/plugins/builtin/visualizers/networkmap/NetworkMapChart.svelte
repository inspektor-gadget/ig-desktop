<script lang="ts">
	import { SvelteFlow, Controls, Background, MiniMap } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import dagre from '@dagrejs/dagre';
	import AddressNode from './AddressNode.svelte';
	import type { NetworkNode, NetworkEdge } from '$lib/types/networkmap';

	interface Props {
		nodes: NetworkNode[];
		edges: NetworkEdge[];
		onNodesChange?: (nodes: NetworkNode[]) => void;
	}

	let { nodes, edges, onNodesChange }: Props = $props();

	// XYFlow's NodeTypes type is complex - using type assertion for compatibility
	const nodeTypes = {
		address: AddressNode
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as Record<string, any>;

	// Track node positions separately (not reactive to avoid circular deps)
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Intentional: non-reactive to avoid circular dependency in effect
	let nodePositions: Map<string, { x: number; y: number }> = new Map();
	// Track which nodes have been manually positioned by the user
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Intentional: non-reactive set for tracking user-moved nodes
	let userPositionedNodes: Set<string> = new Set();
	// Track known node IDs to detect new nodes
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Intentional: non-reactive set for tracking known nodes
	let knownNodeIds: Set<string> = new Set();

	// Track layouted nodes in state
	let layoutedNodes = $state<NetworkNode[]>([]);

	// Apply Dagre layout only to new nodes, preserving existing positions
	function applyLayoutToNewNodes(
		inputNodes: NetworkNode[],
		inputEdges: NetworkEdge[]
	): NetworkNode[] {
		if (inputNodes.length === 0) return inputNodes;

		// Find nodes that need layout (new nodes not yet positioned)
		const nodesToLayout = inputNodes.filter(
			(n) => !knownNodeIds.has(n.id) && !userPositionedNodes.has(n.id)
		);

		// If no new nodes need layout, just apply existing positions
		if (nodesToLayout.length === 0) {
			return inputNodes.map((node) => {
				const existingPos = nodePositions.get(node.id);
				if (existingPos) {
					return { ...node, position: existingPos };
				}
				return node;
			});
		}

		// Run dagre on ALL nodes to get proper layout considering connections
		const g = new dagre.graphlib.Graph();
		g.setGraph({
			rankdir: 'LR',
			nodesep: 80,
			ranksep: 150,
			marginx: 50,
			marginy: 50
		});
		g.setDefaultEdgeLabel(() => ({}));

		for (const node of inputNodes) {
			const handleCount = node.data.handles.length || 1;
			const labelCount = node.data.labels?.length || 1;
			const height = 32 + labelCount * 14 + handleCount * 28;
			g.setNode(node.id, { width: 180, height });
		}

		for (const edge of inputEdges) {
			g.setEdge(edge.source, edge.target);
		}

		dagre.layout(g);

		// Apply positions: use Dagre for new nodes, preserve existing for others
		return inputNodes.map((node) => {
			// If user positioned this node, keep their position
			if (userPositionedNodes.has(node.id)) {
				const userPos = nodePositions.get(node.id);
				if (userPos) {
					return { ...node, position: userPos };
				}
			}

			// If node already has a position and isn't new, keep it
			if (knownNodeIds.has(node.id)) {
				const existingPos = nodePositions.get(node.id);
				if (existingPos) {
					return { ...node, position: existingPos };
				}
			}

			// New node - use Dagre position
			const pos = g.node(node.id);
			if (pos) {
				const handleCount = node.data.handles.length || 1;
				const labelCount = node.data.labels?.length || 1;
				const position = {
					x: pos.x - 90,
					y: pos.y - (16 + labelCount * 7 + handleCount * 14)
				};
				nodePositions.set(node.id, position);
				knownNodeIds.add(node.id);
				return { ...node, position };
			}

			knownNodeIds.add(node.id);
			return node;
		});
	}

	// Handle node drag end - save user position
	function handleNodeDragStop({ targetNode }: { targetNode: NetworkNode | null }) {
		if (targetNode) {
			const position = { x: targetNode.position.x, y: targetNode.position.y };
			nodePositions.set(targetNode.id, position);
			userPositionedNodes.add(targetNode.id);

			// Notify parent of position change
			if (onNodesChange) {
				onNodesChange(layoutedNodes.map((n) => (n.id === targetNode.id ? { ...n, position } : n)));
			}
		}
	}

	// Layout nodes when input changes
	$effect(() => {
		if (nodes.length === 0) {
			layoutedNodes = [];
			nodePositions.clear();
			userPositionedNodes.clear();
			knownNodeIds.clear();
			return;
		}

		layoutedNodes = applyLayoutToNewNodes(nodes, edges);
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
			type: 'smoothstep',
			animated: false
		}}
		class="!bg-transparent"
		onnodedragstop={handleNodeDragStop}
	>
		<Controls position="bottom-right" />
		<Background />
		<MiniMap position="bottom-left" pannable zoomable />
	</SvelteFlow>

	<!-- Stats overlay -->
	<div
		class="absolute top-2 left-2 text-xs text-gray-500 dark:text-gray-400 bg-white/90 dark:bg-gray-800/90 px-2 py-1 rounded pointer-events-none z-10"
	>
		{nodeCount} nodes, {edgeCount} connections
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
