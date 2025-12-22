/**
 * Flamegraph configuration utilities for extracting config from datasource annotations
 * and building hierarchical flame data from events.
 */

import type { Datasource } from '$lib/types/charts';
import type {
	FlameNode,
	FlameNodeSource,
	FlamegraphConfig,
	GroupableField,
	ParsedFrame,
	StackField
} from '$lib/types/flamegraph';

/**
 * Hardcoded groupable field levels for common fields.
 * Lower numbers = closer to root in hierarchy.
 * Includes both casing variants for compatibility.
 */
const GROUPABLE_FIELD_LEVELS: Record<string, number> = {
	'k8s.namespace': 1,
	'k8s.node': 2,
	'k8s.podName': 3,
	'k8s.podname': 3,
	'k8s.containerName': 4,
	'k8s.containername': 4,
	'runtime.containerName': 5,
	'runtime.containername': 5,
	'proc.comm': 10
};

/**
 * Default fields to pre-select for grouping.
 */
export const DEFAULT_GROUP_FIELDS = ['k8s.namespace', 'proc.comm'];

/**
 * Extract flamegraph configuration from datasource annotations.
 * Looks for fields with flamegraph.type annotations.
 *
 * @param ds - Datasource with fields and annotations
 * @returns FlamegraphConfig with stack fields and count field
 */
export function extractFlamegraphConfig(ds: Datasource): FlamegraphConfig {
	const stackFields: StackField[] = [];
	let countField: string | null = null;

	for (const field of ds.fields) {
		const flamegraphType = field.annotations?.['flamegraph.type'];

		if (flamegraphType === 'stack') {
			// This is a stack trace field
			const level = parseInt(field.annotations?.['flamegraph.level'] || '0', 10);
			stackFields.push({
				fieldName: field.fullName,
				level: isNaN(level) ? 0 : level
			});
		} else if (flamegraphType === 'samples' || flamegraphType === 'time') {
			// This is the count/weight field
			countField = field.fullName;
		}
	}

	// Fallback: if no explicit count field, look for a field named "samples"
	if (!countField) {
		const samplesField = ds.fields.find(
			(f) => f.fullName === 'samples' || f.name === 'samples'
		);
		if (samplesField) {
			countField = samplesField.fullName;
		}
	}

	// Sort stack fields by level (ascending) - lower levels at bottom of flamegraph
	stackFields.sort((a, b) => a.level - b.level);

	return {
		stackFields,
		countField,
		isValidFlamegraph: stackFields.length > 0
	};
}

/**
 * Parse a stack string in format "[0]symbol1; [1]symbol2; [N]symbolN".
 * Handles gaps in indexes and returns frames sorted by index ascending.
 *
 * @param stack - Stack trace string to parse
 * @returns Array of parsed frames sorted by index
 */
export function parseStackString(stack: string): ParsedFrame[] {
	if (!stack || typeof stack !== 'string') {
		return [];
	}

	const frames: ParsedFrame[] = [];
	const parts = stack.split(';');

	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;

		// Match [N]symbol format
		const match = trimmed.match(/^\[(\d+)\](.+)$/);
		if (match) {
			const index = parseInt(match[1], 10);
			const symbol = match[2].trim();
			if (symbol) {
				frames.push({ index, symbol });
			}
		} else {
			// Handle frames without explicit index (shouldn't happen but be defensive)
			// Use a very high index so they sort to the end
			frames.push({ index: 999999, symbol: trimmed });
		}
	}

	// Sort by index ascending (0 = deepest/tip, higher = closer to root)
	frames.sort((a, b) => a.index - b.index);

	return frames;
}

/**
 * Build hierarchical flame data from events.
 * Merges multiple stack fields (e.g., kernel + user) based on level ordering.
 *
 * Stack rendering order:
 * - Frames are reversed so higher indexes (entry points) become the root
 * - Lower level stacks (kernel) appear at the bottom, higher levels (user) on top
 *
 * @param events - Array of event records
 * @param config - Flamegraph configuration
 * @returns Root FlameNode of the hierarchy
 */
export function buildFlameHierarchy(
	events: Record<string, unknown>[],
	config: FlamegraphConfig
): FlameNode {
	const root: FlameNode = { name: 'all', value: 0, children: [] };

	if (!config.isValidFlamegraph || events.length === 0) {
		return root;
	}

	for (const event of events) {
		// Get sample count (weight) for this event
		let count = 1;
		if (config.countField && event[config.countField] != null) {
			const rawCount = event[config.countField];
			count = typeof rawCount === 'number' ? rawCount : parseInt(String(rawCount), 10) || 1;
		}

		// Build combined stack from all stack fields (sorted by level)
		// Frames are collected in root-to-tip order for insertion
		const combinedFrames: string[] = [];

		for (const stackField of config.stackFields) {
			const stackStr = event[stackField.fieldName];
			if (typeof stackStr !== 'string' || !stackStr) continue;

			const parsed = parseStackString(stackStr);
			if (parsed.length === 0) continue;

			// Reverse to get root-to-tip order (high index first)
			// This puts entry points at the root, deepest calls at the tips
			const reversed = parsed.slice().reverse();
			combinedFrames.push(...reversed.map((f) => f.symbol));
		}

		if (combinedFrames.length === 0) continue;

		// Insert into hierarchy (root → children)
		let current = root;
		root.value += count;

		for (const symbol of combinedFrames) {
			let child = current.children.find((c) => c.name === symbol);
			if (!child) {
				child = { name: symbol, value: 0, children: [] };
				current.children.push(child);
			}
			child.value += count;
			current = child;
		}
	}

	return root;
}

/**
 * Get all stack field names from a datasource for detection purposes.
 * Used by DatasourceView to check if flamegraph tab should be shown.
 *
 * @param ds - Datasource to check
 * @returns Array of field names that have flamegraph.type=stack annotation
 */
export function getStackFieldNames(ds: Datasource): string[] {
	return ds.fields
		.filter((f) => f.annotations?.['flamegraph.type'] === 'stack')
		.map((f) => f.fullName);
}

/**
 * Compute total samples in the flamegraph.
 * This is the root value and represents 100%.
 *
 * @param root - Root FlameNode
 * @returns Total sample count
 */
export function getTotalSamples(root: FlameNode): number {
	return root.value;
}

/**
 * Calculate percentage of total for a node.
 *
 * @param nodeValue - Node's sample count
 * @param totalValue - Total samples (from root)
 * @returns Percentage as a number (0-100)
 */
export function getPercentage(nodeValue: number, totalValue: number): number {
	if (totalValue === 0) return 0;
	return (nodeValue / totalValue) * 100;
}

/**
 * Extract groupable fields from datasource.
 * Returns fields that exist in schema AND are either:
 * 1. In GROUPABLE_FIELD_LEVELS hardcoded list
 * 2. Have flamegraph.level annotation (non-stack fields)
 *
 * @param ds - Datasource with fields
 * @returns Array of groupable fields sorted by level ascending
 */
export function extractGroupableFields(ds: Datasource): GroupableField[] {
	const fields: GroupableField[] = [];

	for (const field of ds.fields) {
		// Skip stack fields - they're handled separately
		if (field.annotations?.['flamegraph.type'] === 'stack') {
			continue;
		}

		// Get description from annotations if available
		const description = field.annotations?.['description'] as string | undefined;

		// Check if field has explicit flamegraph.level annotation
		const annotatedLevel = field.annotations?.['flamegraph.level'];
		if (annotatedLevel != null) {
			const level = parseInt(String(annotatedLevel), 10);
			if (!isNaN(level)) {
				fields.push({
					fieldName: field.fullName,
					level,
					label: field.name,
					description
				});
				continue;
			}
		}

		// Fall back to hardcoded list
		const hardcodedLevel = GROUPABLE_FIELD_LEVELS[field.fullName];
		if (hardcodedLevel != null) {
			fields.push({
				fieldName: field.fullName,
				level: hardcodedLevel,
				label: field.name,
				description
			});
		}
	}

	// Sort by level ascending (lower = closer to root)
	return fields.sort((a, b) => a.level - b.level);
}

/**
 * Get sample count from an event.
 *
 * @param event - Event record
 * @param config - Flamegraph configuration
 * @returns Sample count (defaults to 1)
 */
function getEventCount(event: Record<string, unknown>, config: FlamegraphConfig): number {
	if (!config.countField || event[config.countField] == null) {
		return 1;
	}
	const rawCount = event[config.countField];
	return typeof rawCount === 'number' ? rawCount : parseInt(String(rawCount), 10) || 1;
}

/**
 * Build stack frames from an event (combined from all stack fields).
 *
 * @param event - Event record
 * @param config - Flamegraph configuration
 * @returns Array of symbols in root-to-tip order
 */
function buildStackFrames(event: Record<string, unknown>, config: FlamegraphConfig): string[] {
	const frames: string[] = [];

	for (const stackField of config.stackFields) {
		const stackStr = event[stackField.fieldName];
		if (typeof stackStr !== 'string' || !stackStr) continue;

		const parsed = parseStackString(stackStr);
		if (parsed.length === 0) continue;

		// Reverse to get root-to-tip order (high index first)
		const reversed = parsed.slice().reverse();
		frames.push(...reversed.map((f) => f.symbol));
	}

	return frames;
}

/**
 * Get or create a child node with the given name.
 *
 * @param parent - Parent node
 * @param name - Child node name
 * @param count - Sample count to add
 * @param source - Optional source information for the node
 * @returns The child node (created if necessary)
 */
function getOrCreateChild(
	parent: FlameNode,
	name: string,
	count: number,
	source?: FlameNodeSource
): FlameNode {
	let child = parent.children.find((c) => c.name === name);
	if (!child) {
		child = { name, value: 0, children: [], source };
		parent.children.push(child);
	}
	child.value += count;
	return child;
}

/**
 * Build flame hierarchy with grouping fields.
 * Grouping fields become hierarchy levels above stack frames.
 *
 * @param events - Array of event records
 * @param config - Flamegraph configuration
 * @param groupFields - Active group fields (sorted by level, with full info)
 * @returns Root FlameNode of the hierarchy
 */
export function buildFlameHierarchyWithGroups(
	events: Record<string, unknown>[],
	config: FlamegraphConfig,
	groupFields: GroupableField[]
): FlameNode {
	const root: FlameNode = { name: 'all', value: 0, children: [] };

	if (!config.isValidFlamegraph || events.length === 0) {
		return root;
	}

	// Build source info for stack fields
	const stackSources: Map<string, FlameNodeSource> = new Map();
	for (const sf of config.stackFields) {
		stackSources.set(sf.fieldName, {
			fieldName: sf.fieldName,
			label: sf.fieldName.split('.').pop() || sf.fieldName,
			type: 'stack'
		});
	}
	// Use the first stack field as default source for all frames
	const defaultStackSource: FlameNodeSource | undefined = config.stackFields.length > 0
		? stackSources.get(config.stackFields[0].fieldName)
		: undefined;

	for (const event of events) {
		// Build stack frames first to check if we should process this event
		const frames = buildStackFrames(event, config);

		// Skip events with no stack frames to maintain parent-child value consistency
		if (frames.length === 0) continue;

		const count = getEventCount(event, config);

		// Build path: group values first, then stack frames
		let current = root;
		root.value += count;

		// Add group field values as hierarchy levels
		for (const groupField of groupFields) {
			const rawValue = event[groupField.fieldName];
			const value = rawValue != null ? String(rawValue) : 'unknown';
			const source: FlameNodeSource = {
				fieldName: groupField.fieldName,
				label: groupField.label,
				description: groupField.description,
				type: 'group'
			};
			current = getOrCreateChild(current, value, count, source);
		}

		// Add stack frames
		for (const symbol of frames) {
			current = getOrCreateChild(current, symbol, count, defaultStackSource);
		}
	}

	return root;
}
