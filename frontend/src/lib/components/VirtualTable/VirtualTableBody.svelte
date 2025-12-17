<script lang="ts" generics="T">
	import { useVirtualScroll } from './useVirtualScroll.svelte';

	/**
	 * VirtualTableBody Component
	 *
	 * A specialized virtualization component for HTML tables with:
	 * - Fixed header that stays visible while body scrolls
	 * - Column width synchronization via colgroup
	 * - Resizable columns with drag handles
	 * - Keyboard navigation (arrow keys, page up/down, home/end)
	 * - Horizontal scroll sync between header and body
	 * - ARIA accessibility attributes
	 *
	 * Uses a split-table approach: header table is separate from body table,
	 * allowing the header to stay fixed while only the body scrolls.
	 *
	 * NOTE: For non-table virtual lists (divs, cards), use VirtualTable instead.
	 *
	 * @example
	 * ```svelte
	 * <VirtualTableBody items={data} columns={columns}>
	 *   {#snippet row(item, index)}
	 *     <td>{item.name}</td>
	 *     <td>{item.value}</td>
	 *   {/snippet}
	 * </VirtualTableBody>
	 * ```
	 */

	interface Column {
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

	// Approximate character width in pixels for monospace font at text-xs (12px)
	const CHAR_WIDTH_PX = 7.2;
	// Padding per cell (px-2 = 0.5rem = 8px each side)
	const CELL_PADDING_PX = 16;
	// Default character width if not specified
	const DEFAULT_CHAR_WIDTH = 16;

	interface CopyEvent {
		/** The selected items being copied */
		items: T[];
		/** The selected indices */
		indices: number[];
		/** Column definitions */
		columns: Column[];
		/** Whether Alt key was held (exclude headers) */
		excludeHeaders: boolean;
	}

	interface Props {
		/** Array of items to display */
		items: T[];
		/** Height of each row in pixels (default: 24) */
		rowHeight?: number;
		/** Number of extra rows to render above/below viewport (default: 5) */
		overscan?: number;
		/** Column definitions for header rendering */
		columns: Column[];
		/** Snippet for rendering each row's cells */
		row: import('svelte').Snippet<[item: T, index: number]>;
		/** Optional snippet for custom header rendering - receives columns and resize context */
		header?: import('svelte').Snippet<
			[
				columns: Column[],
				resizeContext: {
					startResize: (e: PointerEvent, index: number) => void;
					resizingIndex: number | null;
					/** Svelte action to bind header row element for width measurement */
					setHeaderRow: (el: HTMLTableRowElement) => void;
				}
			]
		>;
		/** Optional class for the container */
		class?: string;
		/** Optional function to compute row class based on item, focus, and selection state */
		rowClass?: (item: T, index: number, isFocused: boolean, isSelected: boolean) => string;
		/** Optional click handler for rows */
		onrowclick?: (item: T, index: number, event: MouseEvent) => void;
		/** Optional callback when visible range changes */
		onVisibleRangeChange?: (startIndex: number, endIndex: number) => void;
		/** Optional callback when focus changes */
		onfocus?: (item: T, index: number) => void;
		/** Optional callback when selection changes (provides all selected indices) */
		onselectionchange?: (selectedIndices: number[]) => void;
		/**
		 * Optional callback when user copies selection (Ctrl/Cmd+C).
		 * Receives selected items, indices, columns, and whether Alt was held.
		 * Hold Alt to exclude headers from the copy.
		 */
		oncopy?: (event: CopyEvent) => void;
	}

	let {
		items,
		rowHeight = 24,
		overscan = 5,
		columns,
		row,
		header,
		class: className = '',
		rowClass,
		onrowclick,
		onVisibleRangeChange,
		onfocus,
		onselectionchange,
		oncopy
	}: Props = $props();

	// ===========================================
	// FOCUS STATE (single row that has keyboard focus)
	// ===========================================
	// Track focus by index + items.length at time of focus
	// This allows focus to "stick" to the data row when new items are prepended
	let internalFocusedIndex = $state(-1);
	let itemsLengthAtFocus = $state(0);

	// Adjusted focus index accounting for prepended items
	const focusedIndex = $derived.by(() => {
		if (internalFocusedIndex === -1) return -1;
		const lengthDiff = items.length - itemsLengthAtFocus;
		const adjustedIndex = internalFocusedIndex + lengthDiff;
		if (adjustedIndex < 0 || adjustedIndex >= items.length) return -1;
		return adjustedIndex;
	});

	// ===========================================
	// SELECTION STATE (multiple rows can be selected)
	// ===========================================
	// Store selection as a Set of "original indices" paired with items.length at selection time
	// Each entry is { index, itemsLength } to track position shifts
	let selectionEntries = $state<Array<{ index: number; itemsLength: number }>>([]);

	// Anchor point for shift+click range selection (the starting point of the range)
	let selectionAnchorIndex = $state(-1);
	let selectionAnchorItemsLength = $state(0);

	// Compute adjusted anchor index
	const anchorIndex = $derived.by(() => {
		if (selectionAnchorIndex === -1) return -1;
		const lengthDiff = items.length - selectionAnchorItemsLength;
		const adjustedIndex = selectionAnchorIndex + lengthDiff;
		if (adjustedIndex < 0 || adjustedIndex >= items.length) return -1;
		return adjustedIndex;
	});

	// Derive the current set of selected indices (adjusted for prepended items)
	const selectedIndices = $derived.by(() => {
		const result = new Set<number>();
		for (const entry of selectionEntries) {
			const lengthDiff = items.length - entry.itemsLength;
			const adjustedIndex = entry.index + lengthDiff;
			if (adjustedIndex >= 0 && adjustedIndex < items.length) {
				result.add(adjustedIndex);
			}
		}
		return result;
	});

	// Helper to check if an index is selected
	function isIndexSelected(index: number): boolean {
		return selectedIndices.has(index);
	}

	// State for scroll position and viewport dimensions
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	let container: HTMLDivElement | undefined = $state();
	let headerRow: HTMLTableRowElement | undefined = $state();
	let headerWrapper: HTMLDivElement | undefined = $state();

	// Track scrollbar width for header compensation
	let scrollbarWidth = $state(0);

	// Track column widths from header for body synchronization
	let columnWidths = $state<number[]>([]);

	// Resize state
	let resizingIndex = $state<number | null>(null);
	let resizeStartX = $state(0);
	let resizeStartWidth = $state(0);

	// Drag selection state
	let isDragging = $state(false);
	let dragStartIndex = $state(-1);
	let dragCurrentIndex = $state(-1);
	let dragModifyMode = $state<'replace' | 'add' | 'remove'>('replace');
	let selectionBeforeDrag = $state<Array<{ index: number; itemsLength: number }>>([]);

	function startResize(e: PointerEvent, index: number) {
		e.preventDefault();
		resizingIndex = index;
		resizeStartX = e.clientX;
		resizeStartWidth = columnWidths[index] || 100;

		document.addEventListener('pointermove', handleResize);
		document.addEventListener('pointerup', stopResize);
	}

	function handleResize(e: PointerEvent) {
		if (resizingIndex === null) return;
		const delta = e.clientX - resizeStartX;
		const col = columns[resizingIndex];

		// Calculate min/max in pixels, with fallbacks
		const minPx = col?.minWidth ? charToPixelWidth(col.minWidth) : 50;
		const maxPx = col?.maxWidth ? charToPixelWidth(col.maxWidth) : Infinity;

		// Clamp to min/max
		const newWidth = Math.min(maxPx, Math.max(minPx, resizeStartWidth + delta));
		columnWidths[resizingIndex] = newWidth;
	}

	// Convert character width to pixel width
	function charToPixelWidth(chars: number): number {
		return Math.round(chars * CHAR_WIDTH_PX + CELL_PADDING_PX);
	}

	function stopResize() {
		resizingIndex = null;
		document.removeEventListener('pointermove', handleResize);
		document.removeEventListener('pointerup', stopResize);
	}

	/**
	 * Svelte action to bind header row element for width measurement.
	 * Use as `use:setHeaderRow` on the header <tr> element.
	 */
	function setHeaderRow(el: HTMLTableRowElement) {
		headerRow = el;
	}

	// Calculate virtual scroll state using the utility
	const scrollState = $derived(
		useVirtualScroll({
			totalItems: items.length,
			rowHeight,
			viewportHeight,
			scrollTop,
			overscan
		})
	);

	// Get the visible slice of items to render
	const visibleItems = $derived(items.slice(scrollState.startIndex, scrollState.endIndex));

	// Calculate total table width for horizontal scrolling
	const totalTableWidth = $derived(
		columnWidths.length > 0 ? columnWidths.reduce((sum, w) => sum + w, 0) : 0
	);

	// Notify parent when visible range changes
	$effect(() => {
		if (onVisibleRangeChange) {
			onVisibleRangeChange(scrollState.startIndex, scrollState.endIndex);
		}
	});

	// Handle scroll events (both vertical and horizontal sync)
	function handleScroll(event: Event) {
		const target = event.target as HTMLDivElement;
		scrollTop = target.scrollTop;
		// Sync horizontal scroll to header
		if (headerWrapper) {
			headerWrapper.scrollLeft = target.scrollLeft;
		}
	}

	// Track if widths have been initialized (don't override user resizes)
	let widthsInitialized = $state(false);

	// Calculate initial column widths from annotations (or default)
	$effect(() => {
		if (widthsInitialized || columns.length === 0) return;

		const widths = columns.map((col) => {
			const charWidth = col.width ?? DEFAULT_CHAR_WIDTH;
			return charToPixelWidth(charWidth);
		});
		columnWidths = widths;
		widthsInitialized = true;
	});

	// Reset when columns change (triggers recalculation)
	$effect(() => {
		columns; // dependency
		widthsInitialized = false;
	});

	// Single ResizeObserver for both viewport height and scrollbar width
	// Combined for performance - avoids creating two observers on the same element
	$effect(() => {
		if (!container) return;

		// Capture container reference for use in callback
		const el = container;

		// Initial measurements
		viewportHeight = el.clientHeight;
		scrollbarWidth = el.offsetWidth - el.clientWidth;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// Wrap in rAF to avoid "ResizeObserver loop" warning
				requestAnimationFrame(() => {
					viewportHeight = entry.contentRect.height;
					scrollbarWidth = el.offsetWidth - el.clientWidth;
				});
			}
		});

		resizeObserver.observe(el);

		return () => {
			resizeObserver.disconnect();
		};
	});

	/**
	 * Set focus to a row (does not affect selection).
	 */
	function setFocus(index: number) {
		if (index < 0 || index >= items.length) return;
		internalFocusedIndex = index;
		itemsLengthAtFocus = items.length;
		if (onfocus) {
			onfocus(items[index], index);
		}
	}

	/**
	 * Set the selection anchor (starting point for range selection).
	 */
	function setAnchor(index: number) {
		selectionAnchorIndex = index;
		selectionAnchorItemsLength = items.length;
	}

	/**
	 * Clear all selections.
	 */
	function clearSelection() {
		selectionEntries = [];
		notifySelectionChange();
	}

	/**
	 * Select a single row (clears previous selection).
	 */
	function selectSingle(index: number) {
		if (index < 0 || index >= items.length) return;
		selectionEntries = [{ index, itemsLength: items.length }];
		setAnchor(index);
		notifySelectionChange();
	}

	/**
	 * Toggle selection of a single row (for Ctrl/Meta+Click).
	 */
	function toggleSelection(index: number) {
		if (index < 0 || index >= items.length) return;
		const currentLength = items.length;

		// Check if this index is currently selected
		const existingEntryIndex = selectionEntries.findIndex((entry) => {
			const lengthDiff = currentLength - entry.itemsLength;
			return entry.index + lengthDiff === index;
		});

		if (existingEntryIndex >= 0) {
			// Remove from selection
			selectionEntries = selectionEntries.filter((_, i) => i !== existingEntryIndex);
		} else {
			// Add to selection
			selectionEntries = [...selectionEntries, { index, itemsLength: currentLength }];
		}
		setAnchor(index);
		notifySelectionChange();
	}

	/**
	 * Select a range of rows from anchor to target (for Shift+Click).
	 * Replaces current selection with the range.
	 */
	function selectRange(targetIndex: number) {
		if (targetIndex < 0 || targetIndex >= items.length) return;
		const anchor = anchorIndex >= 0 ? anchorIndex : focusedIndex >= 0 ? focusedIndex : 0;
		const start = Math.min(anchor, targetIndex);
		const end = Math.max(anchor, targetIndex);
		const currentLength = items.length;

		selectionEntries = [];
		for (let i = start; i <= end; i++) {
			selectionEntries.push({ index: i, itemsLength: currentLength });
		}
		notifySelectionChange();
	}

	/**
	 * Extend selection from current focus to new index (for Shift+Arrow keys).
	 * Adds or removes from selection based on direction.
	 */
	function extendSelection(fromIndex: number, toIndex: number) {
		if (toIndex < 0 || toIndex >= items.length) return;
		const currentLength = items.length;

		// Determine anchor point
		const anchor = anchorIndex >= 0 ? anchorIndex : fromIndex;

		// Calculate the new range that should be selected
		const rangeStart = Math.min(anchor, toIndex);
		const rangeEnd = Math.max(anchor, toIndex);

		// Build new selection for the range
		selectionEntries = [];
		for (let i = rangeStart; i <= rangeEnd; i++) {
			selectionEntries.push({ index: i, itemsLength: currentLength });
		}
		notifySelectionChange();
	}

	/**
	 * Notify parent of selection changes.
	 */
	function notifySelectionChange() {
		if (onselectionchange) {
			onselectionchange(Array.from(selectedIndices).sort((a, b) => a - b));
		}
	}

	/**
	 * Handle row click with modifier key support.
	 * Note: This is only called if not dragging (drag end on same row).
	 */
	function handleRowClick(index: number, event: MouseEvent) {
		// If we just finished a drag, don't handle as click
		if (isDragging) return;

		if (event.shiftKey) {
			// Shift+Click: Range selection from anchor/focus to clicked row
			selectRange(index);
			setFocus(index);
		} else if (event.metaKey || event.ctrlKey) {
			// Ctrl/Meta+Click: Toggle selection of clicked row
			toggleSelection(index);
			setFocus(index);
		} else {
			// Normal click: Single selection
			selectSingle(index);
			setFocus(index);
		}
	}

	/**
	 * Get row index from a mouse event Y position.
	 */
	function getRowIndexFromY(clientY: number): number {
		if (!container) return -1;
		const rect = container.getBoundingClientRect();
		const relativeY = clientY - rect.top + scrollTop;
		const index = Math.floor(relativeY / rowHeight);
		return Math.max(0, Math.min(items.length - 1, index));
	}

	/**
	 * Start drag selection on mousedown.
	 */
	function handleDragStart(index: number, event: MouseEvent) {
		// Don't start drag on right-click or if modifier for toggle
		if (event.button !== 0) return;
		if (event.metaKey || event.ctrlKey) return; // Let click handler deal with toggle

		isDragging = true;
		dragCurrentIndex = index;

		// Determine drag mode based on shift key and whether start row is selected
		if (event.shiftKey) {
			// Shift+click/drag: use existing anchor as start point for range selection
			// This allows shift+click to extend from previous selection anchor
			dragStartIndex = anchorIndex >= 0 ? anchorIndex : index;
			dragModifyMode = 'replace';
			selectionBeforeDrag = [];
		} else {
			// Normal drag: replace selection starting from clicked row
			dragStartIndex = index;
			dragModifyMode = 'replace';
			selectionBeforeDrag = [];
		}

		// Set initial selection
		updateDragSelection();
		setFocus(index);

		// Listen for mouse movement and release
		document.addEventListener('mousemove', handleDragMove);
		document.addEventListener('mouseup', handleDragEnd);
	}

	/**
	 * Update selection during drag.
	 */
	function handleDragMove(event: MouseEvent) {
		if (!isDragging) return;

		const newIndex = getRowIndexFromY(event.clientY);
		if (newIndex !== dragCurrentIndex) {
			dragCurrentIndex = newIndex;
			updateDragSelection();
			setFocus(newIndex);
			scrollRowIntoView(newIndex);
		}
	}

	/**
	 * End drag selection on mouseup.
	 */
	function handleDragEnd() {
		document.removeEventListener('mousemove', handleDragMove);
		document.removeEventListener('mouseup', handleDragEnd);

		// Small delay to prevent click from firing after drag
		setTimeout(() => {
			isDragging = false;
		}, 0);
	}

	/**
	 * Update selection based on current drag state.
	 */
	function updateDragSelection() {
		const currentLength = items.length;
		const start = Math.min(dragStartIndex, dragCurrentIndex);
		const end = Math.max(dragStartIndex, dragCurrentIndex);

		// Build set of indices in drag range
		const dragRangeIndices = new Set<number>();
		for (let i = start; i <= end; i++) {
			dragRangeIndices.add(i);
		}

		if (dragModifyMode === 'replace') {
			// Replace selection with drag range
			const dragSelection: Array<{ index: number; itemsLength: number }> = [];
			for (let i = start; i <= end; i++) {
				dragSelection.push({ index: i, itemsLength: currentLength });
			}
			selectionEntries = dragSelection;
		} else if (dragModifyMode === 'add') {
			// Add drag range to existing selection (union)
			const merged = new Map<number, { index: number; itemsLength: number }>();

			// Add pre-drag selection
			for (const entry of selectionBeforeDrag) {
				const lengthDiff = currentLength - entry.itemsLength;
				const adjustedIndex = entry.index + lengthDiff;
				if (adjustedIndex >= 0 && adjustedIndex < items.length) {
					merged.set(adjustedIndex, { index: adjustedIndex, itemsLength: currentLength });
				}
			}

			// Add drag range
			for (let i = start; i <= end; i++) {
				merged.set(i, { index: i, itemsLength: currentLength });
			}

			selectionEntries = Array.from(merged.values());
		} else if (dragModifyMode === 'remove') {
			// Remove drag range from existing selection
			const result: Array<{ index: number; itemsLength: number }> = [];

			for (const entry of selectionBeforeDrag) {
				const lengthDiff = currentLength - entry.itemsLength;
				const adjustedIndex = entry.index + lengthDiff;
				// Keep if valid and NOT in drag range
				if (
					adjustedIndex >= 0 &&
					adjustedIndex < items.length &&
					!dragRangeIndices.has(adjustedIndex)
				) {
					result.push({ index: adjustedIndex, itemsLength: currentLength });
				}
			}

			selectionEntries = result;
		}

		// Set anchor to drag start for subsequent shift operations
		setAnchor(dragStartIndex);
		notifySelectionChange();
	}

	/**
	 * Scroll to ensure a row index is visible in the viewport.
	 * Scrolls minimally - only if the row is outside the visible area.
	 */
	function scrollRowIntoView(index: number) {
		if (!container) return;

		const rowTop = index * rowHeight;
		const rowBottom = rowTop + rowHeight;
		const viewTop = scrollTop;
		const viewBottom = scrollTop + viewportHeight;

		let newScrollTop = scrollTop;

		if (rowTop < viewTop) {
			// Row is above viewport - scroll up to show it at top
			newScrollTop = rowTop;
		} else if (rowBottom > viewBottom) {
			// Row is below viewport - scroll down to show it at bottom
			newScrollTop = rowBottom - viewportHeight;
		} else {
			// Row is already visible - no scroll needed
			return;
		}

		container.scrollTo({
			top: newScrollTop,
			behavior: 'smooth'
		});
	}

	// Handle keyboard navigation for focus and selection
	function handleKeydown(event: KeyboardEvent) {
		if (!container || items.length === 0) return;

		const pageSize = Math.max(1, Math.floor(viewportHeight / rowHeight) - 1);
		const maxIndex = items.length - 1;
		const currentFocus = focusedIndex;
		let newIndex = currentFocus;

		switch (event.key) {
			case 'ArrowUp':
				newIndex = currentFocus <= 0 ? 0 : currentFocus - 1;
				event.preventDefault();
				break;
			case 'ArrowDown':
				newIndex = currentFocus < 0 ? 0 : Math.min(maxIndex, currentFocus + 1);
				event.preventDefault();
				break;
			case 'PageUp':
				newIndex = currentFocus <= 0 ? 0 : Math.max(0, currentFocus - pageSize);
				event.preventDefault();
				break;
			case 'PageDown':
				newIndex = currentFocus < 0 ? 0 : Math.min(maxIndex, currentFocus + pageSize);
				event.preventDefault();
				break;
			case 'Home':
				newIndex = 0;
				event.preventDefault();
				break;
			case 'End':
				newIndex = maxIndex;
				event.preventDefault();
				break;
			case 'Enter':
				// Trigger click action on focused row
				if (currentFocus >= 0 && onrowclick) {
					onrowclick(items[currentFocus], currentFocus, event as unknown as MouseEvent);
				}
				event.preventDefault();
				return;
			case 'Escape':
				// Clear selection
				clearSelection();
				event.preventDefault();
				return;
			case 'a':
				// Ctrl/Meta+A: Select all
				if (event.metaKey || event.ctrlKey) {
					const currentLength = items.length;
					selectionEntries = [];
					for (let i = 0; i < items.length; i++) {
						selectionEntries.push({ index: i, itemsLength: currentLength });
					}
					notifySelectionChange();
					event.preventDefault();
				}
				return;
			case 'c':
				// Ctrl/Meta+C: Copy selection
				if ((event.metaKey || event.ctrlKey) && oncopy) {
					const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
					if (sortedIndices.length > 0) {
						const selectedItems = sortedIndices.map((i) => items[i]);
						oncopy({
							items: selectedItems,
							indices: sortedIndices,
							columns,
							excludeHeaders: event.altKey
						});
						event.preventDefault();
					}
				}
				return;
			default:
				return;
		}

		if (newIndex !== currentFocus) {
			if (event.shiftKey) {
				// Shift+Arrow: Extend selection from anchor to new position
				// Set anchor on first shift-navigation if not set
				if (anchorIndex === -1 && currentFocus >= 0) {
					setAnchor(currentFocus);
				}
				extendSelection(currentFocus, newIndex);
			} else {
				// Normal navigation: Move focus and select single row
				selectSingle(newIndex);
				// Update inspector with the newly focused row
				if (onrowclick) {
					onrowclick(items[newIndex], newIndex, event as unknown as MouseEvent);
				}
			}
			setFocus(newIndex);
			scrollRowIntoView(newIndex);
		}
	}

	// Exported function to scroll to a specific row index
	export function scrollToIndex(index: number) {
		if (!container) return;
		const targetScrollTop = index * rowHeight;
		// Center the row in the viewport if possible
		const centeredScrollTop = Math.max(0, targetScrollTop - viewportHeight / 2 + rowHeight / 2);
		container.scrollTo({
			top: centeredScrollTop,
			behavior: 'smooth'
		});
	}
</script>

<div class="virtual-table-container {className}">
	<!-- Header table (stays fixed at top, scrolls horizontally with body) -->
	<div class="virtual-table-header" bind:this={headerWrapper}>
		<div class="header-scroll-content">
			<table
				class="virtual-table"
				style={totalTableWidth > 0 ? `width: ${totalTableWidth}px;` : ''}
			>
				{#if columnWidths.length > 0}
					<colgroup>
						{#each columnWidths as width}
							<col style="width: {width}px;" />
						{/each}
					</colgroup>
				{/if}
				<thead>
					{#if header}
						{@render header(columns, { startResize, resizingIndex, setHeaderRow })}
					{:else}
						<tr bind:this={headerRow}>
							{#each columns as column, i}
								<th style={column.width ? `width: ${column.width};` : ''} class="relative">
									{column.label}
									{#if i < columns.length - 1}
										<div
											class="resize-handle"
											class:active={resizingIndex === i}
											onpointerdown={(e) => startResize(e, i)}
										></div>
									{/if}
								</th>
							{/each}
						</tr>
					{/if}
				</thead>
			</table>
			<!-- Spacer to compensate for body's vertical scrollbar width -->
			{#if scrollbarWidth > 0}
				<div class="scrollbar-spacer" style="width: {scrollbarWidth}px;"></div>
			{/if}
		</div>
	</div>

	<!-- Scrollable body container -->
	<div
		bind:this={container}
		class="virtual-table-body"
		onscroll={handleScroll}
		onkeydown={handleKeydown}
		tabindex="0"
		role="grid"
		aria-rowcount={items.length}
	>
		<!-- Spacer to create correct scrollbar height -->
		<div class="virtual-table-spacer" style="height: {scrollState.totalHeight}px;">
			<!-- Positioned content container -->
			<div class="virtual-table-content" style="top: {scrollState.offsetY}px;">
				<table
					class="virtual-table"
					style={totalTableWidth > 0 ? `width: ${totalTableWidth}px;` : ''}
				>
					{#if columnWidths.length > 0}
						<colgroup>
							{#each columnWidths as width}
								<col style="width: {width}px;" />
							{/each}
						</colgroup>
					{/if}
					<tbody>
						{#each visibleItems as item, i}
							{@const actualIndex = scrollState.startIndex + i}
							{@const isFocused = actualIndex === focusedIndex}
							{@const isSelected = isIndexSelected(actualIndex)}
							<tr
								style="height: {rowHeight}px;"
								aria-rowindex={actualIndex + 1}
								aria-selected={isSelected}
								class="{rowClass
									? rowClass(item, actualIndex, isFocused, isSelected)
									: ''} {isFocused ? 'virtual-table-focused' : ''} {isSelected
									? 'virtual-table-selected'
									: ''}"
								onmousedown={(e) => handleDragStart(actualIndex, e)}
								onclick={(e) => {
									handleRowClick(actualIndex, e);
									if (onrowclick) onrowclick(item, actualIndex, e);
								}}
							>
								{@render row(item, actualIndex)}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>

<style>
	.virtual-table-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.virtual-table-header {
		flex-shrink: 0;
		/* Use hidden to prevent user-initiated scrolling (trackpad/wheel).
		   Programmatic scrollLeft still works for syncing with body. */
		overflow-x: hidden;
		overflow-y: hidden;
	}

	.header-scroll-content {
		display: flex;
	}

	.scrollbar-spacer {
		flex-shrink: 0;
	}

	.virtual-table-body {
		flex: 1;
		overflow: auto;
		position: relative;
		outline: none;
		/* Prevent text selection - interferes with row multi-select */
		user-select: none;
		-webkit-user-select: none;
	}

	.virtual-table-spacer {
		position: relative;
		/* Width is set by child table for horizontal scroll */
	}

	.virtual-table-content {
		position: absolute;
		left: 0;
		/* Width follows table width */
	}

	.virtual-table {
		table-layout: fixed;
		border-collapse: collapse;
		/* Width is set inline via totalTableWidth - do NOT use min-width: 100%
		   as it causes header/body mismatch due to scrollbar width difference */
	}

	.virtual-table th {
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.virtual-table :global(td) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.resize-handle {
		position: absolute;
		right: -3px;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: col-resize;
		z-index: 10;
	}

	.resize-handle:hover,
	.resize-handle.active {
		background: rgb(59 130 246 / 0.5);
	}

	/* Selected row styling - uses :global because row is rendered via snippet */
	:global(.virtual-table-selected) {
		background-color: rgb(59 130 246 / 0.2);
	}

	:global(.virtual-table-selected:hover) {
		background-color: rgb(59 130 246 / 0.3);
	}

	/* Focused row styling - shows which row has keyboard focus */
	:global(.virtual-table-focused) {
		outline: 2px solid rgb(59 130 246 / 0.7);
		outline-offset: -2px;
	}

	/* Focused + selected row */
	:global(.virtual-table-focused.virtual-table-selected) {
		background-color: rgb(59 130 246 / 0.3);
	}

	:global(.virtual-table-focused.virtual-table-selected:hover) {
		background-color: rgb(59 130 246 / 0.4);
	}
</style>
