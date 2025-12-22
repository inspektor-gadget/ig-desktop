/**
 * Flamegraph type definitions
 *
 * These types support hierarchical flamegraph rendering from stack trace data.
 * Stack traces are parsed from gadget fields annotated with flamegraph.type=stack.
 */

/**
 * Source information for a flamegraph node.
 */
export interface FlameNodeSource {
	/** Source field name (e.g., "k8s.namespace", "proc.comm", or stack field name) */
	fieldName: string;
	/** Human-readable label */
	label: string;
	/** Optional description from field annotations */
	description?: string;
	/** Type of node: 'group' for grouping fields, 'stack' for stack frames */
	type: 'group' | 'stack';
}

/**
 * Node in the flamegraph hierarchy tree.
 * Each node represents a function/symbol in the call stack.
 */
export interface FlameNode {
	/** Function/symbol name */
	name: string;
	/** Aggregated sample count (determines width) */
	value: number;
	/** Child frames called by this function */
	children: FlameNode[];
	/** Source field information (for tooltip display) */
	source?: FlameNodeSource;
}

/**
 * Configuration for a stack trace field.
 * Multiple stack fields can be merged (e.g., kernel + user stacks).
 */
export interface StackField {
	/** Field name in the event data */
	fieldName: string;
	/** Sort order for merging stacks (lower = bottom of flamegraph) */
	level: number;
}

/**
 * Parsed stack frame from stack string format.
 */
export interface ParsedFrame {
	/** Depth index from the stack string (e.g., 0 for [0]symbol) */
	index: number;
	/** Function/symbol name */
	symbol: string;
}

/**
 * Flamegraph configuration extracted from datasource annotations.
 */
export interface FlamegraphConfig {
	/** Stack trace fields sorted by level (ascending) */
	stackFields: StackField[];
	/** Field containing sample count/weight (null = use 1 per event) */
	countField: string | null;
	/** Whether this datasource has valid flamegraph configuration */
	isValidFlamegraph: boolean;
}

/**
 * Groupable field for hierarchical grouping above stack frames.
 * Fields like proc.comm, k8s.namespace become hierarchy levels.
 */
export interface GroupableField {
	/** Field name in the event data */
	fieldName: string;
	/** Sort order for hierarchy (lower = closer to root) */
	level: number;
	/** Display label for the field */
	label: string;
	/** Optional description from field annotations */
	description?: string;
}

/**
 * Render node for flattened flamegraph display.
 * Used internally by the flamegraph renderer.
 */
export interface FlamegraphRenderNode {
	/** Reference to the flame node */
	node: FlameNode;
	/** Normalized X position (0-1) */
	x: number;
	/** Normalized width (0-1) */
	width: number;
	/** Depth from current root */
	depth: number;
	/** Whether this node matches the current search */
	isHighlighted: boolean;
}
