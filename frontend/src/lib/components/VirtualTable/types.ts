/**
 * Types for VirtualTable components
 */

export interface VirtualTableColumn {
	key: string;
	label: string;
	/** Expected character width (default: 16) */
	width?: number;
	/** Minimum character width */
	minWidth?: number;
	/** Maximum character width */
	maxWidth?: number;
	/** Text alignment (default: left) */
	align?: 'left' | 'right' | 'center';
}

export interface VirtualTableCopyEvent<T> {
	/** The selected items being copied */
	items: T[];
	/** The selected indices */
	indices: number[];
	/** Column definitions */
	columns: VirtualTableColumn[];
	/** Whether Alt key was held (exclude headers) */
	excludeHeaders: boolean;
}
