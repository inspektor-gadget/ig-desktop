/**
 * Hook system for extending table functionality
 *
 * This module defines interfaces for a plugin-style hook system that allows
 * extending table behavior without modifying core table code.
 *
 * Hook types:
 * - ColumnHook: Add computed/synthetic columns
 * - RowHook: Enrich rows with async data when they become visible
 * - CellHook: Custom rendering for specific columns
 *
 * Future extensions could include:
 * - ActionHook: Context menu actions
 * - FilterHook: Custom filter predicates
 * - SortHook: Custom sort comparators
 */

import type { TableColumn, EnrichedRow } from './table';

/**
 * ColumnHook adds synthetic columns to the table.
 *
 * Example use cases:
 * - Computed columns (e.g., "severity" derived from multiple fields)
 * - Aggregated data (e.g., "related count" from background queries)
 * - Metadata columns (e.g., "threat score" from external API)
 */
export interface ColumnHook {
	/** Unique hook identifier */
	id: string;
	/** Columns to add to the table */
	columns: TableColumn[];
}

/**
 * RowHook processes rows when they become visible.
 *
 * This enables efficient async enrichment:
 * - Only visible rows are processed
 * - Processing happens in priority order
 * - Errors are caught and logged
 *
 * Example use cases:
 * - IP geolocation lookup
 * - Threat intelligence queries
 * - Related event counting
 * - DNS reverse lookups
 */
export interface RowHook {
	/** Unique hook identifier */
	id: string;
	/**
	 * Process visible rows (async).
	 * Hook should write enrichments to row.enrichments[fieldName].
	 *
	 * @param rows - Currently visible rows
	 * @param columns - All table columns (for context)
	 */
	process: (rows: EnrichedRow[], columns: TableColumn[]) => Promise<void>;
	/** Priority for processing order (lower = earlier, default: 0) */
	priority?: number;
}

/**
 * CellHook provides custom rendering for specific columns.
 *
 * Example use cases:
 * - Sparklines for time-series data
 * - Status badges with colors
 * - Interactive buttons/links
 * - Custom formatters (IP addresses, timestamps, etc.)
 */
export interface CellHook {
	/** Unique hook identifier */
	id: string;
	/**
	 * Determine if this hook applies to a column.
	 * Called once per column during table setup.
	 *
	 * @param column - Column to check
	 * @returns true if this hook should render cells in this column
	 */
	match: (column: TableColumn) => boolean;
	/**
	 * Render cell value as string or HTML.
	 *
	 * @param value - Cell value from row data or enrichments
	 * @param row - Full row context (data + enrichments)
	 * @param column - Column being rendered
	 * @returns String content or { html: string } for HTML rendering
	 */
	render: (value: any, row: EnrichedRow, column: TableColumn) => string | { html: string };
}

/**
 * TableHookRegistry is the central registry for all hooks.
 * Passed to Table component as optional prop.
 */
export interface TableHookRegistry {
	/** Hooks that add columns */
	columnHooks: ColumnHook[];
	/** Hooks that process visible rows */
	rowHooks: RowHook[];
	/** Hooks that customize cell rendering */
	cellHooks: CellHook[];
}

/**
 * Factory function type for creating hook registries.
 * Useful for gadget-specific hook configurations.
 */
export type CreateHookRegistry = () => TableHookRegistry;
