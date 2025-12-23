/**
 * Extensible table data model for Inspektor Gadget Desktop
 *
 * This module defines types for a flexible table that supports:
 * - Dynamic columns from gadget schema and hooks
 * - Row enrichment from async hook processing
 * - Custom rendering and formatting
 */

/**
 * TableColumn defines a column in the table.
 * Columns can come from gadget schema or be added by hooks.
 */
export interface TableColumn {
	// Identity
	/** Unique column identifier */
	id: string;
	/** Where column came from */
	source: 'gadget' | 'hook';

	// Display
	/** Header text */
	label: string;
	/** Tooltip description */
	description?: string;

	// Data
	/** Key in row data (supports dot notation) */
	field: string;
	/** Data type (for alignment, formatting) */
	kind?: string;

	// Rendering
	/** CSS width */
	width?: string;
	/** Text alignment */
	align?: 'left' | 'right' | 'center';
	/** Custom renderer function */
	render?: (value: any, row: any) => string | { html: string };

	// Behavior
	/** Whether column can be sorted */
	sortable?: boolean;
	/** Whether column can be filtered */
	filterable?: boolean;
	/** Whether column is hidden */
	hidden?: boolean;
	/** Sort order in column list */
	order?: number;
}

/**
 * EnrichedRow wraps original row data with hook-added enrichments.
 * This keeps original data immutable while allowing async enhancement.
 */
export interface EnrichedRow<T = any> {
	/** Original row data from gadget */
	data: T;
	/** Hook-added data (e.g., threat scores, related events) */
	enrichments: Record<string, any>;
	/** Processing status for async operations */
	status: {
		/** Async processing in progress */
		processing?: boolean;
		/** Processing error message */
		error?: string;
	};
}

/**
 * TableState represents the complete state of the table.
 */
export interface TableState {
	/** Column definitions (gadget + hook columns) */
	columns: TableColumn[];
	/** Enriched rows with original data + hook enrichments */
	rows: EnrichedRow[];
}

/**
 * TableMenuController exposes column visibility controls to parent components.
 * Used by DatasourceView to render the column toggle menu outside the Table component.
 */
export interface TableMenuController {
	/** Fields that can be toggled (excludes always-visible fields) */
	toggleableFields: Array<{ fullName: string; name: string }>;
	/** Check if a column is currently visible */
	isColumnVisible: (fieldName: string) => boolean;
	/** Toggle visibility of a column */
	toggleColumnVisibility: (fieldName: string) => void;
}
