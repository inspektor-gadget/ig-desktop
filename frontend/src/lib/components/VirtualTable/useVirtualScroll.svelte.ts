/**
 * Virtual Scroll State
 * Represents the computed state for virtual scrolling
 */
export interface VirtualScrollState {
	/** Index of the first visible item (including overscan) */
	startIndex: number;
	/** Index of the last visible item (including overscan) */
	endIndex: number;
	/** Y-offset for positioning the visible content */
	offsetY: number;
	/** Total height of all items (for scrollbar sizing) */
	totalHeight: number;
}

/**
 * Virtual Scroll Parameters
 * Input parameters for virtual scroll calculations
 */
export interface VirtualScrollParams {
	/** Total number of items in the list */
	totalItems: number;
	/** Height of each row in pixels */
	rowHeight: number;
	/** Height of the visible viewport in pixels */
	viewportHeight: number;
	/** Current scroll position from the top in pixels */
	scrollTop: number;
	/** Number of extra rows to render above/below viewport (default: 5) */
	overscan?: number;
}

/**
 * Creates a virtual scroll state manager using Svelte 5 runes
 *
 * This utility calculates which items should be rendered based on the current
 * scroll position and viewport size, enabling efficient rendering of large lists.
 *
 * @param params - Reactive parameters for virtual scrolling
 * @returns Reactive virtual scroll state
 *
 * @example
 * ```typescript
 * const scrollState = useVirtualScroll({
 *   totalItems: items.length,
 *   rowHeight: 24,
 *   viewportHeight,
 *   scrollTop,
 *   overscan: 5
 * });
 * ```
 */
export function useVirtualScroll(params: VirtualScrollParams): VirtualScrollState {
	const overscan = params.overscan ?? 5;

	// Calculate the total height needed for all items
	const totalHeight = $derived(params.totalItems * params.rowHeight);

	// Calculate the index of the first visible item
	const firstVisibleIndex = $derived(Math.floor(params.scrollTop / params.rowHeight));

	// Calculate how many items can fit in the viewport
	const visibleCount = $derived(Math.ceil(params.viewportHeight / params.rowHeight));

	// Calculate the index of the last visible item
	const lastVisibleIndex = $derived(firstVisibleIndex + visibleCount);

	// Calculate start index with overscan, ensuring it doesn't go below 0
	const startIndex = $derived(Math.max(0, firstVisibleIndex - overscan));

	// Calculate end index with overscan, ensuring it doesn't exceed total items
	const endIndex = $derived(Math.min(params.totalItems, lastVisibleIndex + overscan));

	// Calculate the Y offset for positioning the visible content
	// This positions the visible items at the correct scroll position
	const offsetY = $derived(startIndex * params.rowHeight);

	return {
		get startIndex() {
			return startIndex;
		},
		get endIndex() {
			return endIndex;
		},
		get offsetY() {
			return offsetY;
		},
		get totalHeight() {
			return totalHeight;
		}
	};
}
