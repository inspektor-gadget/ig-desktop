import dagre from '@dagrejs/dagre';
import type { NetworkEdge, NetworkNamespaceGroupNode, NetworkNode } from '$lib/types/networkmap';

const NODE_WIDTH = 180;
const NODE_GAP = 80;
const GROUP_PADDING = 50;
const GROUP_GAP = 40;

function nodeHeight(node: NetworkNode): number {
	return 32 + (node.data.labels.length || 1) * 14 + (node.data.handles.length || 1) * 28;
}

export function networkNodeNamespace(node: NetworkNode): string | undefined {
	return node.data.labels.find((label) => label.field === 'namespace')?.value || undefined;
}

function layoutGraph(nodes: NetworkNode[], edges: NetworkEdge[]) {
	const graph = new dagre.graphlib.Graph();
	graph.setGraph({
		rankdir: 'LR',
		nodesep: NODE_GAP,
		ranksep: 150,
		marginx: GROUP_PADDING,
		marginy: GROUP_PADDING
	});
	graph.setDefaultEdgeLabel(() => ({}));

	for (const node of nodes) {
		graph.setNode(node.id, { width: NODE_WIDTH, height: nodeHeight(node) });
	}
	for (const edge of edges) {
		graph.setEdge(edge.source, edge.target);
	}
	dagre.layout(graph);

	return new Map(
		nodes.map((node) => {
			const position = graph.node(node.id);
			return [node.id, { x: position.x - NODE_WIDTH / 2, y: position.y }];
		})
	);
}

export function networkMapTopologyKey(nodes: NetworkNode[]): string {
	return nodes
		.map(
			(node) =>
				`${networkNodeNamespace(node) ?? ''}\u0001${node.id}\u0001${node.data.labels.length}\u0001${node.data.handles.length}`
		)
		.sort()
		.join(',');
}

export function layoutNetworkMap(
	nodes: NetworkNode[],
	edges: NetworkEdge[]
): {
	nodes: (NetworkNode | NetworkNamespaceGroupNode)[];
	edges: NetworkEdge[];
} {
	const byNamespace = new Map<string, NetworkNode[]>();
	const ungrouped: NetworkNode[] = [];
	const positions = layoutGraph(nodes, edges);

	for (const node of nodes) {
		const namespace = networkNodeNamespace(node);
		if (!namespace) {
			ungrouped.push(node);
			continue;
		}
		const group = byNamespace.get(namespace) ?? [];
		group.push(node);
		byNamespace.set(namespace, group);
	}

	const layouted: (NetworkNode | NetworkNamespaceGroupNode)[] = [];
	const graphWidth =
		Math.max(...nodes.map((node) => (positions.get(node.id)?.x ?? 0) + NODE_WIDTH)) + GROUP_PADDING;
	let y = 0;

	for (const namespace of [...byNamespace.keys()].sort()) {
		const laneNodes = byNamespace
			.get(namespace)!
			.sort((a, b) => (positions.get(a.id)?.y ?? 0) - (positions.get(b.id)?.y ?? 0));
		const laneHeight =
			GROUP_PADDING * 2 +
			laneNodes.reduce((height, node) => height + nodeHeight(node), 0) +
			Math.max(0, laneNodes.length - 1) * NODE_GAP;
		const groupId = `namespace\u0001${namespace}`;
		layouted.push({
			id: groupId,
			type: 'networkNamespaceGroup',
			position: { x: 0, y },
			width: graphWidth,
			height: laneHeight,
			selectable: false,
			draggable: false,
			focusable: false,
			zIndex: -1,
			data: { label: namespace }
		});
		let childY = GROUP_PADDING;
		for (const node of laneNodes) {
			layouted.push({
				...node,
				parentId: groupId,
				extent: 'parent',
				position: { x: positions.get(node.id)?.x ?? GROUP_PADDING, y: childY }
			});
			childY += nodeHeight(node) + NODE_GAP;
		}
		y += laneHeight + GROUP_GAP;
	}

	if (ungrouped.length > 0) {
		let ungroupedY = y + GROUP_PADDING;
		for (const node of ungrouped.sort(
			(a, b) => (positions.get(a.id)?.y ?? 0) - (positions.get(b.id)?.y ?? 0)
		)) {
			layouted.push({
				...node,
				position: { x: positions.get(node.id)?.x ?? GROUP_PADDING, y: ungroupedY }
			});
			ungroupedY += nodeHeight(node) + NODE_GAP;
		}
	}

	return { nodes: layouted, edges };
}
