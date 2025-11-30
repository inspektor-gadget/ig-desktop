/**
 * Table adapters for converting between gadget schema and table data model
 *
 * This module provides utilities to:
 * - Convert gadget fields to TableColumn definitions
 * - Wrap raw events in EnrichedRow structure for hook support
 * - Access row values with enrichment support
 */

import type { TableColumn, EnrichedRow } from '$lib/types/table';

/**
 * Converts a gadget field to a TableColumn definition.
 *
 * @param field - Gadget field descriptor with fullName, kind, flags, annotations, order
 * @param env - Optional environment info for runtime-specific visibility rules
 * @returns TableColumn configuration
 */
export function gadgetFieldToColumn(field: any, env?: any): TableColumn {
	return {
		id: field.fullName || 'unknown',
		source: 'gadget',
		label: field.fullName || 'Unknown',
		description: field.annotations?.description,
		field: field.fullName || 'unknown',
		kind: field.kind,
		align: getColumnAlignment(field),
		sortable: true,
		filterable: true,
		hidden: shouldHideColumn(field, env),
		order: field.order || 0
	};
}

/**
 * Determines column alignment from annotations or field kind.
 * Explicit columns.alignment annotation takes precedence over numeric-based alignment.
 *
 * @param field - Gadget field descriptor
 * @returns Alignment value ('left', 'right', or 'center')
 */
export function getColumnAlignment(field: any): 'left' | 'right' | 'center' {
	const explicitAlign = field.annotations?.['columns.alignment'];
	if (explicitAlign === 'left' || explicitAlign === 'right' || explicitAlign === 'center') {
		return explicitAlign;
	}
	// Fall back to numeric-based alignment
	return isNumericKind(field.kind) ? 'right' : 'left';
}

/**
 * Numeric field kinds for right alignment.
 * Exported for consistent use across components.
 */
export const NUMERIC_KINDS = [
	'Uint64',
	'Uint32',
	'Uint16',
	'Int64',
	'Int32',
	'Int16',
	'Float32',
	'Float64'
] as const;

/**
 * Determines if a field kind represents a numeric type.
 * Numeric types are right-aligned by convention.
 *
 * @param kind - Field kind from gadget schema
 * @returns true if kind is numeric
 */
export function isNumericKind(kind: string | undefined): boolean {
	if (!kind) return false;
	return (NUMERIC_KINDS as readonly string[]).includes(kind);
}

/**
 * Determines if a column should be hidden based on field properties and environment.
 * Implements existing visibility logic from Table.svelte.
 *
 * @param field - Gadget field descriptor
 * @param env - Optional environment info
 * @returns true if column should be hidden
 */
function shouldHideColumn(field: any, env?: any): boolean {
	// Explicit hidden annotation
	if (field.annotations?.['columns.hidden'] === 'true') return true;

	// Field flags: container (0x0002) or empty (0x0001)
	if (field.flags) {
		if (field.flags & 0x0002) return true; // container flag
		if (field.flags & 0x0001) return true; // empty flag
	}

	// Runtime-specific: hide kubernetes fields in grpc-ig runtime
	if (env?.runtime === 'grpc-ig' && field.tags?.includes('kubernetes')) {
		return true;
	}

	return false;
}

/**
 * Wraps raw event data in EnrichedRow structure.
 * This prepares rows for async hook enrichment without mutating original data.
 *
 * @param events - Array of raw event objects from gadget
 * @returns Array of EnrichedRow objects with empty enrichments
 */
export function wrapRowsForEnrichment<T>(events: T[]): EnrichedRow<T>[] {
	if (!events) return [];
	return events.map((data) => ({
		data,
		enrichments: {},
		status: {}
	}));
}

/**
 * Gets the value for a column from an enriched row.
 * Hook enrichments take precedence over original data.
 *
 * @param row - EnrichedRow with original data and enrichments
 * @param column - TableColumn to get value for
 * @returns Value from enrichments or original data, or undefined if not found
 */
export function getRowValue(row: EnrichedRow, column: TableColumn): any {
	if (!row) return undefined;

	// Hook enrichments take precedence
	if (column.source === 'hook' && column.field in row.enrichments) {
		return row.enrichments[column.field];
	}

	// Fall back to original data
	// Handle null/undefined data gracefully
	if (!row.data) return undefined;

	// Support dot notation for nested fields (e.g., "user.name")
	if (column.field.includes('.')) {
		return getNestedValue(row.data, column.field);
	}

	return row.data[column.field];
}

/**
 * Gets a nested value from an object using dot notation.
 *
 * @param obj - Object to extract value from
 * @param path - Dot-separated path (e.g., "user.name")
 * @returns Value at path or undefined if not found
 */
function getNestedValue(obj: any, path: string): any {
	if (!obj) return undefined;

	const keys = path.split('.');
	let value = obj;

	for (const key of keys) {
		if (value == null) return undefined;
		value = value[key];
	}

	return value;
}
