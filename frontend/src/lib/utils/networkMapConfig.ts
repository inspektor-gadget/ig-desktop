/**
 * Network map configuration utilities for extracting config from datasource
 * and processing network connection events into a graph structure.
 */

import type { Datasource } from '$lib/types/charts';
import type {
	NetworkMapConfig,
	NetworkMapFieldConfig,
	NetworkNode,
	NetworkEdge,
	NetworkHandle,
	NetworkGraphState,
	NetworkNodeLabel,
	NetworkMapOptions
} from '$lib/types/networkmap';
import {
	EDGE_ANIMATION_DURATION,
	NODE_ACTIVITY_TIMEOUT,
	DEFAULT_EPHEMERAL_PORT_THRESHOLD
} from '$lib/types/networkmap';

/**
 * Hardcoded field name patterns for network map detection.
 * In the future, this will be replaced/supplemented by annotation-based detection
 * (e.g., networkmap.type=source-addr, networkmap.type=dest-addr).
 */
const NETWORK_MAP_FIELD_PATTERNS = {
	srcAddr: ['src.addr', 'srcAddr', 'source.addr', 'src_addr', 'saddr', 'src.ip', 'srcip'],
	srcPort: ['src.port', 'srcPort', 'source.port', 'src_port', 'sport'],
	dstAddr: ['dst.addr', 'dstAddr', 'dest.addr', 'dst_addr', 'daddr', 'dst.ip', 'dstip'],
	dstPort: ['dst.port', 'dstPort', 'dest.port', 'dst_port', 'dport'],
	proto: ['proto', 'protocol', 'l4protocol', 'src.proto', 'dst.proto', 'l4proto']
};

/**
 * Hardcoded keying field patterns for node identity.
 * These fields, when present, are used to create composite node keys.
 */
const KEYING_FIELD_PATTERNS = {
	src: ['src.k8s.namespace', 'src.k8s.name', 'src.k8s.kind'],
	dst: ['dst.k8s.namespace', 'dst.k8s.name', 'dst.k8s.kind'],
	// Shared fields used for both src/dst when traffic is local (127.0.0.1 <-> 127.0.0.1)
	shared: ['k8s.namespace', 'k8s.name', 'k8s.kind', 'k8s.containerName', 'k8s.podName']
};

/**
 * Localhost addresses that indicate local traffic.
 */
const LOCALHOST_ADDRESSES = ['127.0.0.1', '::1', 'localhost'];

/**
 * Get short display name for a field (last part after dot).
 */
function getFieldShortName(fieldName: string): string {
	const parts = fieldName.split('.');
	return parts[parts.length - 1];
}

/**
 * Extract network map configuration from datasource.
 * Uses hardcoded field name patterns and annotations.
 *
 * Annotations supported:
 *   - networkmap.type=source-addr / dest-addr
 *   - networkmap.role=port / protocol
 *   - networkmap.key=source / dest (for keying fields)
 */
export function extractNetworkMapConfig(ds: Datasource): NetworkMapConfig {
	const fieldNames = new Set(ds.fields.map((f) => f.fullName));

	// Helper to find matching field using patterns
	function findField(patterns: string[]): string | undefined {
		for (const pattern of patterns) {
			if (fieldNames.has(pattern)) return pattern;
		}
		return undefined;
	}

	// Helper to find all matching fields using patterns
	function findFields(patterns: string[]): string[] {
		return patterns.filter((pattern) => fieldNames.has(pattern));
	}

	// First, check for annotation-based detection
	let srcAddr: string | undefined;
	let srcPort: string | undefined;
	let dstAddr: string | undefined;
	let dstPort: string | undefined;
	let proto: string | undefined;
	const srcKeyFieldsFromAnnotations: string[] = [];
	const dstKeyFieldsFromAnnotations: string[] = [];

	for (const field of ds.fields) {
		const mapType = field.annotations?.['networkmap.type'];
		const mapRole = field.annotations?.['networkmap.role'];
		const mapKey = field.annotations?.['networkmap.key'];

		if (mapType === 'source-addr') srcAddr = field.fullName;
		else if (mapType === 'dest-addr') dstAddr = field.fullName;
		else if (mapRole === 'port') {
			if (field.fullName.toLowerCase().includes('src')) srcPort = field.fullName;
			else if (field.fullName.toLowerCase().includes('dst')) dstPort = field.fullName;
		} else if (mapRole === 'protocol') proto = field.fullName;

		// Keying fields from annotations
		if (mapKey === 'source') srcKeyFieldsFromAnnotations.push(field.fullName);
		else if (mapKey === 'dest') dstKeyFieldsFromAnnotations.push(field.fullName);
	}

	// Fall back to hardcoded field name patterns if annotations not found
	if (!srcAddr) srcAddr = findField(NETWORK_MAP_FIELD_PATTERNS.srcAddr);
	if (!dstAddr) dstAddr = findField(NETWORK_MAP_FIELD_PATTERNS.dstAddr);
	if (!srcPort) srcPort = findField(NETWORK_MAP_FIELD_PATTERNS.srcPort);
	if (!dstPort) dstPort = findField(NETWORK_MAP_FIELD_PATTERNS.dstPort);
	if (!proto) proto = findField(NETWORK_MAP_FIELD_PATTERNS.proto);

	// Find keying fields (from annotations or hardcoded patterns)
	const srcKeyFields =
		srcKeyFieldsFromAnnotations.length > 0
			? srcKeyFieldsFromAnnotations
			: findFields(KEYING_FIELD_PATTERNS.src);
	const dstKeyFields =
		dstKeyFieldsFromAnnotations.length > 0
			? dstKeyFieldsFromAnnotations
			: findFields(KEYING_FIELD_PATTERNS.dst);

	// Find shared keying fields (used when both src/dst are localhost)
	const sharedKeyFieldsFromAnnotations: string[] = [];
	for (const field of ds.fields) {
		if (field.annotations?.['networkmap.key'] === 'shared') {
			sharedKeyFieldsFromAnnotations.push(field.fullName);
		}
	}
	const sharedKeyFields =
		sharedKeyFieldsFromAnnotations.length > 0
			? sharedKeyFieldsFromAnnotations
			: findFields(KEYING_FIELD_PATTERNS.shared);

	// Must have both source and destination address for valid network map
	if (!srcAddr || !dstAddr) {
		return { fields: null, isValidNetworkMap: false };
	}

	const fields: NetworkMapFieldConfig = {
		srcAddr,
		srcPort,
		dstAddr,
		dstPort,
		proto,
		srcKeyFields: srcKeyFields.length > 0 ? srcKeyFields : undefined,
		dstKeyFields: dstKeyFields.length > 0 ? dstKeyFields : undefined,
		sharedKeyFields: sharedKeyFields.length > 0 ? sharedKeyFields : undefined
	};

	return { fields, isValidNetworkMap: true };
}

/**
 * Label for collapsed ephemeral ports.
 */
const EPHEMERAL_PORT_LABEL = 'high';

/**
 * Generate a handle ID from proto and port, optionally collapsing ephemeral ports.
 */
export function getHandleId(proto: string, port: number, ephemeralThreshold: number = 0): string {
	if (ephemeralThreshold > 0 && port >= ephemeralThreshold) {
		return `${proto}:${EPHEMERAL_PORT_LABEL}`;
	}
	return `${proto}:${port}`;
}

/**
 * Get display port for a handle (returns threshold+ for ephemeral).
 */
export function getDisplayPort(port: number, ephemeralThreshold: number = 0): string {
	if (ephemeralThreshold > 0 && port >= ephemeralThreshold) {
		return `${ephemeralThreshold}+`;
	}
	return String(port);
}

/**
 * Default options for network map processing.
 */
export const DEFAULT_NETWORK_MAP_OPTIONS: NetworkMapOptions = {
	ephemeralPortThreshold: DEFAULT_EPHEMERAL_PORT_THRESHOLD
};

/**
 * Generate an edge ID from source/target node and handle IDs.
 */
export function getEdgeId(
	sourceNodeId: string,
	sourceHandleId: string,
	targetNodeId: string,
	targetHandleId: string
): string {
	return `${sourceNodeId}:${sourceHandleId}->${targetNodeId}:${targetHandleId}`;
}

/**
 * Create an empty network graph state.
 */
export function createEmptyGraphState(): NetworkGraphState {
	return {
		nodesMap: new Map(),
		edgesMap: new Map(),
		version: 0
	};
}

/**
 * Build node ID from address and keying field values.
 */
function buildNodeId(
	addr: string,
	keyFields: string[] | undefined,
	event: Record<string, unknown>
): string {
	if (!keyFields || keyFields.length === 0) {
		return addr;
	}

	// Build composite key from keying fields + address
	const keyParts: string[] = [];
	for (const field of keyFields) {
		const value = event[field] as string | undefined;
		if (value) {
			keyParts.push(value);
		}
	}
	// Always include address as part of the key
	keyParts.push(addr);

	return keyParts.join('|');
}

/**
 * Build labels from keying fields and address.
 */
function buildNodeLabels(
	addr: string,
	keyFields: string[] | undefined,
	event: Record<string, unknown>
): NetworkNodeLabel[] {
	const labels: NetworkNodeLabel[] = [];

	// Add keying fields first (in order)
	if (keyFields) {
		for (const field of keyFields) {
			const value = event[field] as string | undefined;
			if (value) {
				labels.push({
					field: getFieldShortName(field),
					value
				});
			}
		}
	}

	// Always add address last
	labels.push({
		field: 'addr',
		value: addr
	});

	return labels;
}

/**
 * Get or create a node in the graph.
 */
function getOrCreateNode(
	nodesMap: Map<string, NetworkNode>,
	nodeId: string,
	addr: string,
	labels: NetworkNodeLabel[],
	now: number
): NetworkNode {
	let node = nodesMap.get(nodeId);
	if (!node) {
		// Primary label is the first label (most specific)
		const primaryLabel = labels[0]?.value ?? addr;

		node = {
			id: nodeId,
			type: 'address',
			position: { x: 0, y: 0 },
			data: {
				addr,
				labels,
				label: primaryLabel,
				handles: [],
				connectionCount: 0,
				isActive: true,
				lastSeen: now
			}
		};
		nodesMap.set(nodeId, node);
	}
	return node;
}

/**
 * Get or create a handle on a node.
 */
function getOrCreateHandle(
	node: NetworkNode,
	proto: string,
	port: number,
	type: 'source' | 'target',
	now: number,
	ephemeralThreshold: number = 0
): NetworkHandle {
	const handleId = getHandleId(proto, port, ephemeralThreshold);
	const isEphemeral = ephemeralThreshold > 0 && port >= ephemeralThreshold;
	// For ephemeral ports, use the threshold as the display port
	const displayPort = isEphemeral ? ephemeralThreshold : port;

	let handle = node.data.handles.find((h) => h.id === handleId);
	if (!handle) {
		handle = {
			id: handleId,
			proto,
			port: displayPort,
			type,
			connectionCount: 0,
			isActive: true,
			lastSeen: now
		};
		node.data.handles.push(handle);
		// Sort handles: regular ports ascending, ephemeral (high) ports at the end
		node.data.handles.sort((a, b) => {
			const aIsHigh = a.id.endsWith(':high');
			const bIsHigh = b.id.endsWith(':high');
			if (aIsHigh && !bIsHigh) return 1;
			if (!aIsHigh && bIsHigh) return -1;
			return a.port - b.port;
		});
	}
	return handle;
}

/**
 * Process events and update the network graph state.
 * Returns a new state object if changes were made.
 */
export function processEvents(
	state: NetworkGraphState,
	events: Record<string, unknown>[],
	config: NetworkMapFieldConfig,
	now: number = Date.now(),
	options: NetworkMapOptions = DEFAULT_NETWORK_MAP_OPTIONS
): NetworkGraphState {
	if (events.length === 0) return state;

	const { ephemeralPortThreshold } = options;

	// Clone maps for immutable update
	const nodesMap = new Map(state.nodesMap);
	const edgesMap = new Map(state.edgesMap);
	let version = state.version;

	for (const event of events) {
		const srcAddr = event[config.srcAddr] as string | undefined;
		const dstAddr = event[config.dstAddr] as string | undefined;

		if (!srcAddr || !dstAddr) continue;

		const srcPort = config.srcPort ? (event[config.srcPort] as number | undefined) : undefined;
		const dstPort = config.dstPort ? (event[config.dstPort] as number | undefined) : undefined;
		const proto = config.proto ? (event[config.proto] as string | undefined) : undefined;

		// Default values if not provided
		const effectiveSrcPort = srcPort ?? 0;
		const effectiveDstPort = dstPort ?? 0;
		const effectiveProto = proto ?? 'TCP';

		// Determine which keying fields to use
		// When both src and dst are localhost, use shared keying fields for both
		const isLocalTraffic =
			LOCALHOST_ADDRESSES.includes(srcAddr) && LOCALHOST_ADDRESSES.includes(dstAddr);

		const srcKeyFields = isLocalTraffic ? config.sharedKeyFields : config.srcKeyFields;
		const dstKeyFields = isLocalTraffic ? config.sharedKeyFields : config.dstKeyFields;

		// Build node IDs and labels using keying fields
		const srcNodeId = buildNodeId(srcAddr, srcKeyFields, event);
		const srcLabels = buildNodeLabels(srcAddr, srcKeyFields, event);
		const dstNodeId = buildNodeId(dstAddr, dstKeyFields, event);
		const dstLabels = buildNodeLabels(dstAddr, dstKeyFields, event);

		// Get or create source node
		const srcNode = getOrCreateNode(nodesMap, srcNodeId, srcAddr, srcLabels, now);
		srcNode.data.connectionCount++;
		srcNode.data.isActive = true;
		srcNode.data.lastSeen = now;

		// Get or create source handle (ephemeral collapse applied)
		const srcHandle = getOrCreateHandle(
			srcNode,
			effectiveProto,
			effectiveSrcPort,
			'source',
			now,
			ephemeralPortThreshold
		);
		srcHandle.connectionCount++;
		srcHandle.isActive = true;
		srcHandle.lastSeen = now;

		// Get or create destination node
		const dstNode = getOrCreateNode(nodesMap, dstNodeId, dstAddr, dstLabels, now);
		dstNode.data.connectionCount++;
		dstNode.data.isActive = true;
		dstNode.data.lastSeen = now;

		// Get or create destination handle (ephemeral collapse applied)
		const dstHandle = getOrCreateHandle(
			dstNode,
			effectiveProto,
			effectiveDstPort,
			'target',
			now,
			ephemeralPortThreshold
		);
		dstHandle.connectionCount++;
		dstHandle.isActive = true;
		dstHandle.lastSeen = now;

		// Get or create edge (using node IDs for source/target)
		const edgeId = getEdgeId(srcNodeId, srcHandle.id, dstNodeId, dstHandle.id);
		let edge = edgesMap.get(edgeId);
		if (!edge) {
			edge = {
				id: edgeId,
				source: srcNodeId,
				target: dstNodeId,
				sourceHandle: srcHandle.id,
				targetHandle: dstHandle.id,
				data: {
					count: 0,
					proto: effectiveProto,
					lastSeen: now,
					isActive: true
				}
			};
			edgesMap.set(edgeId, edge);
		}

		// Update edge data
		const currentData = edge.data ?? { count: 0, lastSeen: now, isActive: true };
		edge.data = {
			...currentData,
			count: currentData.count + 1,
			lastSeen: now,
			isActive: true
		};

		version++;
	}

	return { nodesMap, edgesMap, version };
}

/**
 * Update activity states based on time elapsed.
 * Returns a new state if any changes were made.
 */
export function updateActivityStates(
	state: NetworkGraphState,
	now: number = Date.now()
): NetworkGraphState {
	let hasChanges = false;
	const nodesMap = new Map(state.nodesMap);
	const edgesMap = new Map(state.edgesMap);

	// Update node and handle activity
	for (const [id, node] of nodesMap) {
		let nodeChanged = false;
		const updatedHandles = node.data.handles.map((handle) => {
			if (handle.isActive && now - handle.lastSeen > EDGE_ANIMATION_DURATION) {
				nodeChanged = true;
				return { ...handle, isActive: false };
			}
			return handle;
		});

		if (node.data.isActive && now - node.data.lastSeen > NODE_ACTIVITY_TIMEOUT) {
			nodesMap.set(id, {
				...node,
				data: { ...node.data, isActive: false, handles: updatedHandles }
			});
			hasChanges = true;
		} else if (nodeChanged) {
			nodesMap.set(id, {
				...node,
				data: { ...node.data, handles: updatedHandles }
			});
			hasChanges = true;
		}
	}

	// Update edge activity
	for (const [id, edge] of edgesMap) {
		const edgeData = edge.data;
		if (edgeData && edgeData.isActive && now - edgeData.lastSeen > EDGE_ANIMATION_DURATION) {
			edgesMap.set(id, {
				...edge,
				data: { ...edgeData, isActive: false }
			});
			hasChanges = true;
		}
	}

	if (!hasChanges) return state;

	return { nodesMap, edgesMap, version: state.version };
}

/**
 * Convert graph state to arrays for XYFlow.
 */
export function graphStateToArrays(state: NetworkGraphState): {
	nodes: NetworkNode[];
	edges: NetworkEdge[];
} {
	return {
		nodes: Array.from(state.nodesMap.values()),
		edges: Array.from(state.edgesMap.values())
	};
}
