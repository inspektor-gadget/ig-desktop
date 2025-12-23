/**
 * Network map type definitions for visualizing network connections.
 */

import type { Node, Edge } from '@xyflow/svelte';

/**
 * Handle representing a proto:port connection point on a node.
 */
export interface NetworkHandle {
	/** Unique identifier: "proto:port" */
	id: string;
	/** Protocol (TCP, UDP, etc.) */
	proto: string;
	/** Port number */
	port: number;
	/** Whether this handle acts as source or target */
	type: 'source' | 'target';
	/** Number of connections using this handle */
	connectionCount: number;
	/** Whether the handle has recent activity */
	isActive: boolean;
	/** Last activity timestamp */
	lastSeen: number;
}

/**
 * Label entry for node display (from keying fields).
 */
export interface NetworkNodeLabel {
	/** Field name (e.g., "containerName", "podName", "addr") */
	field: string;
	/** Display value */
	value: string;
}

/**
 * Data stored in each network map node.
 */
export interface NetworkNodeData extends Record<string, unknown> {
	/** IP address or hostname */
	addr: string;
	/** Display labels from keying fields (containerName, podName, addr) */
	labels: NetworkNodeLabel[];
	/** Primary display label (first non-empty keying field) */
	label: string;
	/** Handles for each proto:port combination */
	handles: NetworkHandle[];
	/** Total connection count for this node */
	connectionCount: number;
	/** Whether the node has recent activity */
	isActive: boolean;
	/** Timestamp of last activity */
	lastSeen: number;
}

/**
 * XYFlow node type for network map.
 */
export type NetworkNode = Node<NetworkNodeData, 'address'>;

/**
 * Data stored in each network map edge.
 */
export interface NetworkEdgeData extends Record<string, unknown> {
	/** Connection count */
	count: number;
	/** Protocol */
	proto?: string;
	/** Timestamp of last activity */
	lastSeen: number;
	/** Whether the edge is currently animating (recent traffic) */
	isActive: boolean;
	/** Animation timeout ID for cleanup */
	animationTimeout?: ReturnType<typeof setTimeout>;
}

/**
 * XYFlow edge type for network map.
 */
export type NetworkEdge = Edge<NetworkEdgeData>;

/**
 * Field configuration for network map data extraction.
 */
export interface NetworkMapFieldConfig {
	/** Source address field name */
	srcAddr: string;
	/** Source port field name (optional) */
	srcPort?: string;
	/** Destination address field name */
	dstAddr: string;
	/** Destination port field name (optional) */
	dstPort?: string;
	/** Protocol field name (optional) */
	proto?: string;
	/** Source keying fields for node identity (containerName, podName, etc.) */
	srcKeyFields?: string[];
	/** Destination keying fields for node identity */
	dstKeyFields?: string[];
	/** Shared keying fields used for both src/dst when traffic is local (127.0.0.1) */
	sharedKeyFields?: string[];
}

/**
 * Network map configuration extracted from datasource.
 */
export interface NetworkMapConfig {
	/** Field mappings for network data */
	fields: NetworkMapFieldConfig | null;
	/** Whether this datasource has valid network map configuration */
	isValidNetworkMap: boolean;
}

/**
 * Network graph state for incremental updates.
 */
export interface NetworkGraphState {
	/** All nodes by ID */
	nodesMap: Map<string, NetworkNode>;
	/** All edges by ID */
	edgesMap: Map<string, NetworkEdge>;
	/** Version counter for reactivity */
	version: number;
}

/**
 * Duration for edge activity highlight (milliseconds).
 * Edges stay highlighted for this duration after traffic.
 */
export const EDGE_ANIMATION_DURATION = 1500;

/**
 * Node activity timeout - nodes become inactive after this duration (ms).
 */
export const NODE_ACTIVITY_TIMEOUT = 5000;

/**
 * Default threshold for collapsing ephemeral (high) ports.
 * Ports >= this value are grouped into a single "ephemeral" handle.
 * Linux ephemeral range starts at 32768, IANA suggests 49152.
 */
export const DEFAULT_EPHEMERAL_PORT_THRESHOLD = 32768;

/**
 * Options for network map processing.
 */
export interface NetworkMapOptions {
	/**
	 * Threshold for collapsing ephemeral ports.
	 * Ports >= this value are grouped. Set to 0 to disable.
	 */
	ephemeralPortThreshold: number;
}
