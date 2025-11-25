<script lang="ts">
	import Table from '$lib/icons/table-column.svg?raw';
	import Dots from '$lib/icons/dots-vertical.svg?raw';
	import { getContext } from 'svelte';
	import { environments } from '$lib/shared/environments.svelte';
	import { page } from '$app/state';
	import VirtualTableBody from '$lib/components/VirtualTable/VirtualTableBody.svelte';
	import type { TableHookRegistry } from '$lib/types/table-hooks';
	import type { TableColumn, EnrichedRow } from '$lib/types/table';
	import {
		gadgetFieldToColumn,
		wrapRowsForEnrichment,
		getColumnAlignment
	} from '$lib/utils/table-adapters';
	import { configuration } from '$lib/stores/configuration.svelte';
	import type { EventRingBuffer } from '$lib/utils/ring-buffer';
	import { entryMatchesSearch } from '$lib/utils/search-match';

	let {
		ds,
		events,
		snapshotData,
		eventVersion = 0,
		searchQuery = '',
		searchModeFilter = true,
		searchHighlightInFilterMode = false,
		onMatchInfo,
		currentMatchIndex = -1,
		onScrollToIndex,
		hookRegistry = null,
		isRunning = true,
		showHeader = true,
		onSortChange,
		sortReset = 0
	}: {
		ds: any;
		events?: EventRingBuffer<any> | undefined;
		/** Direct array data from snapshots (for array datasources) */
		snapshotData?: any[] | undefined;
		eventVersion?: number;
		searchQuery?: string;
		searchModeFilter?: boolean;
		searchHighlightInFilterMode?: boolean;
		onMatchInfo?: (info: {
			matchCount: number;
			totalCount: number;
			matchIndices: number[];
		}) => void;
		currentMatchIndex?: number;
		onScrollToIndex?: (scrollFn: (index: number) => void) => void;
		hookRegistry?: TableHookRegistry | null;
		isRunning?: boolean;
		showHeader?: boolean;
		/** Callback when custom sorting is applied (column name) or cleared (null) */
		onSortChange?: (sortColumn: string | null) => void;
		/** Trigger to reset sorting - increment to reset */
		sortReset?: number;
	} = $props();

	// Get gadget info from context
	const gadgetContext: any = getContext('gadget');
	const gadgetImage = $derived(gadgetContext?.info?.imageName || '');

	// Column visibility menu state
	let menuOpen = $state(false);
	let menuButton: HTMLButtonElement | undefined = $state();

	// Sorting state (active when gadget is stopped OR when viewing snapshots)
	let sortColumn = $state<string | null>(null);
	let sortDirection = $state<'asc' | 'desc'>('asc');

	// Snapshot mode allows sorting while running (since data is discrete snapshots)
	const isSnapshotMode = $derived(snapshotData !== undefined);

	// Sorting is allowed when gadget is stopped OR when in snapshot mode
	const canSort = $derived(!isRunning || isSnapshotMode);

	// Handle column header click for sorting
	function handleColumnSort(fieldName: string) {
		if (!canSort) return;
		if (sortColumn === fieldName) {
			// Toggle direction if clicking same column
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			// New column, start with ascending
			sortColumn = fieldName;
			sortDirection = 'asc';
		}
	}

	// Reset sorting when gadget starts running (but not in snapshot mode)
	$effect(() => {
		if (isRunning && !isSnapshotMode) {
			sortColumn = null;
			sortDirection = 'asc';
		}
	});

	// Reset sorting when sortReset trigger changes (skip initial value of 0)
	let lastSortReset = 0;
	$effect(() => {
		if (sortReset > 0 && sortReset !== lastSortReset) {
			lastSortReset = sortReset;
			sortColumn = null;
			sortDirection = 'asc';
		}
	});

	// Notify parent when sort changes
	$effect(() => {
		onSortChange?.(sortColumn);
	});

	// Configuration key for column visibility (per gadget + datasource)
	const columnVisibilityKey = $derived(
		gadgetImage ? `columnVisibility:${gadgetImage}:${ds.name}` : ''
	);

	// Get hidden columns from configuration
	const hiddenColumns = $derived.by(() => {
		if (!columnVisibilityKey) return new Set<string>();
		const stored = configuration.get(columnVisibilityKey) as string[] | undefined;
		return new Set(stored || []);
	});

	// Toggle column visibility
	function toggleColumnVisibility(fieldName: string) {
		if (!columnVisibilityKey) return;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Local Set for O(1) operations, immediately converted to array
		const current = new Set(hiddenColumns);
		if (current.has(fieldName)) {
			current.delete(fieldName);
		} else {
			current.add(fieldName);
		}
		configuration.set(columnVisibilityKey, Array.from(current));
	}

	// Check if a column is visible
	function isColumnVisible(fieldName: string): boolean {
		return !hiddenColumns.has(fieldName);
	}

	// Close menu when clicking outside
	function handleClickOutside(event: MouseEvent) {
		if (menuOpen && menuButton && !menuButton.contains(event.target as Node)) {
			const menu = document.getElementById('column-menu');
			if (menu && !menu.contains(event.target as Node)) {
				menuOpen = false;
			}
		}
	}

	// Set up click outside listener
	$effect(() => {
		if (menuOpen) {
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});

	// Minimum characters required for text highlighting (performance optimization)
	const MIN_HIGHLIGHT_LENGTH = 3;
	// Debounce delay for search query changes (milliseconds)
	const FILTER_DEBOUNCE_MS = 150;

	// Pre-compute search state for reactivity - cache the lowercase version
	const lowerSearchQuery = $derived(searchQuery.toLowerCase());

	// Highlight text when: highlight button is enabled AND query is long enough
	const shouldHighlightText = $derived(
		searchQuery.length >= MIN_HIGHLIGHT_LENGTH && searchHighlightInFilterMode
	);

	// Check if a specific entry matches (for highlight mode row background)
	const isHighlightMode = $derived(!searchModeFilter && searchQuery.length > 0);

	// ============================================================
	// FILTERING SYSTEM
	// When no search query is active, display events directly from ring buffer.
	// When filtering is needed, offload to Web Worker to keep UI responsive.
	// Uses incremental filtering for streaming data to avoid cloning entire array.
	// ============================================================

	// State for worker-filtered results (only used when searching)
	let workerFilteredEvents = $state<any[]>([]);
	let computedMatchIndices = $state<number[]>([]);
	// Track if we've received first filter result to avoid showing empty view
	let hasReceivedFilterResult = $state(false);

	// Web Worker instance and request tracking
	let filterWorker: Worker | null = null;
	let pendingRequestId = 0;
	let lastCompletedRequestId = 0;
	let filterDebounceTimeout: ReturnType<typeof setTimeout> | undefined;

	// Track state for incremental filtering
	// Using version instead of length because ring buffer length plateaus at capacity
	let lastFilteredQuery = '';
	let lastFilteredVersion = 0;
	let lastFilteredLength = 0;
	let lastSnapshotDataRef: unknown[] | undefined = undefined; // Track snapshotData identity
	let workerInitialized = false;

	// Initialize Web Worker
	$effect(() => {
		filterWorker = new Worker(new URL('$lib/workers/filter.worker.ts', import.meta.url), {
			type: 'module'
		});

		filterWorker.onmessage = (e) => {
			const { type, id, filteredEvents: results, matchIndices: indices } = e.data;
			if (type === 'filter-result' && id > lastCompletedRequestId) {
				lastCompletedRequestId = id;
				workerFilteredEvents = results;
				computedMatchIndices = indices;
				hasReceivedFilterResult = true;
			}
		};

		workerInitialized = true;

		return () => {
			filterWorker?.terminate();
			filterWorker = null;
			workerInitialized = false;
		};
	});

	// Check if we need filtering (search query in filter mode)
	const needsFiltering = $derived(searchQuery.length > 0 && searchModeFilter);

	// Request full refilter via Web Worker (for query changes)
	function requestFullFilter() {
		if (!filterWorker || !needsFiltering) return;

		// Get all events - from snapshotData (array datasource) or events ring buffer
		const allEvents = snapshotData !== undefined ? snapshotData : (events?.toArray() ?? []);
		if (allEvents.length === 0) return;

		pendingRequestId++;
		filterWorker.postMessage({
			type: 'filter',
			id: pendingRequestId,
			events: $state.snapshot(allEvents),
			query: searchQuery,
			fieldNames: $state.snapshot(visibleFieldNames)
		});
	}

	// Request incremental filter via Web Worker (for new events only)
	function requestIncrementalFilter(newEventsCount: number) {
		// For snapshotData, we always do full filter since it's a complete replacement
		if (snapshotData !== undefined) {
			requestFullFilter();
			return;
		}

		if (!filterWorker || !needsFiltering || newEventsCount <= 0 || !events) return;

		// Get only the NEW events from ring buffer (they're at indices 0 to newEventsCount-1)
		// Ring buffer's slice() returns plain objects, no serialization needed
		const newEvents = events.slice(0, newEventsCount);

		pendingRequestId++;
		filterWorker.postMessage({
			type: 'filter-incremental',
			id: pendingRequestId,
			newEvents: $state.snapshot(newEvents),
			query: searchQuery,
			fieldNames: $state.snapshot(visibleFieldNames)
		});
	}

	// Reset worker state when filtering is disabled
	$effect(() => {
		if (!needsFiltering && filterWorker) {
			filterWorker.postMessage({ type: 'reset' });
			lastFilteredQuery = '';
			lastFilteredVersion = 0;
			lastFilteredLength = 0;
			lastSnapshotDataRef = undefined;
			workerFilteredEvents = [];
			computedMatchIndices = [];
			hasReceivedFilterResult = false;
		}
	});

	// Trigger filter when dependencies change
	// - Full refilter on query changes or snapshotData changes (debounced)
	// - Incremental filter on new events (immediate, only sends new events)
	$effect(() => {
		// Only run worker filtering when we have a search query in filter mode
		if (!needsFiltering || !workerInitialized) return;

		// For snapshotData mode, need different handling
		const hasData = snapshotData !== undefined ? snapshotData.length > 0 : events !== undefined;
		if (!hasData) return;

		// Track reactive dependencies
		// eventVersion is a reactive prop that changes when events are added
		const currentVersion = eventVersion;
		const currentLength = snapshotData !== undefined ? snapshotData.length : (events?.length ?? 0);
		const currentQuery = searchQuery;
		void visibleFields; // Track for reactivity

		// Detect what changed
		const queryChanged = currentQuery !== lastFilteredQuery;
		const versionChanged = currentVersion !== lastFilteredVersion;
		const snapshotDataChanged = snapshotData !== lastSnapshotDataRef;
		const newEventsCount = currentLength - lastFilteredLength;

		// Clear pending debounce
		if (filterDebounceTimeout) {
			clearTimeout(filterDebounceTimeout);
		}

		if (queryChanged || snapshotDataChanged || lastFilteredVersion === 0) {
			// Query changed, snapshotData changed, or first filter - need full refilter (debounced)
			filterDebounceTimeout = setTimeout(() => {
				lastFilteredQuery = currentQuery;
				lastFilteredVersion = currentVersion;
				lastFilteredLength = currentLength;
				lastSnapshotDataRef = snapshotData;
				requestFullFilter();
			}, FILTER_DEBOUNCE_MS);
		} else if (versionChanged && newEventsCount > 0) {
			// Only new events arrived - use incremental filter (immediate)
			// This only sends the new events, not the entire array
			lastFilteredVersion = currentVersion;
			lastFilteredLength = currentLength;
			requestIncrementalFilter(newEventsCount);
		}
		// Note: if ring buffer wrapped (newEventsCount <= 0 but version changed),
		// we should do a full refilter, but for simplicity we skip it here.
		// The worker's filtered list may have stale entries but they'll be
		// at the end and not visible in the virtual scroll anyway.

		return () => {
			if (filterDebounceTimeout) {
				clearTimeout(filterDebounceTimeout);
			}
		};
	});

	// Convert ring buffer to array for display
	// When not filtering, get array from ring buffer; when filtering, use worker results
	// eventVersion prop is a reactive signal from parent that changes when events are added
	// While waiting for first filter result, show unfiltered events to avoid blank screen
	const unsortedEvents = $derived.by(() => {
		// Access eventVersion to create dependency - this is updated by parent when events change
		void eventVersion;

		// If snapshotData is provided (array datasource), use it directly
		if (snapshotData !== undefined) {
			if (needsFiltering && hasReceivedFilterResult) {
				return workerFilteredEvents;
			}
			return snapshotData;
		}

		// Otherwise use events ring buffer
		if (needsFiltering && hasReceivedFilterResult) {
			return workerFilteredEvents;
		}
		return events?.toArray() ?? [];
	});

	// Apply sorting when allowed (stopped or snapshot mode) and a sort column is selected
	const displayEvents = $derived.by(() => {
		if (!sortColumn || !canSort) {
			return unsortedEvents;
		}

		// Create a sorted copy
		const sorted = [...unsortedEvents];
		const col = sortColumn;
		const dir = sortDirection;

		sorted.sort((a, b) => {
			const aVal = a[col];
			const bVal = b[col];

			// Handle null/undefined
			if (aVal == null && bVal == null) return 0;
			if (aVal == null) return dir === 'asc' ? -1 : 1;
			if (bVal == null) return dir === 'asc' ? 1 : -1;

			// Compare based on type
			if (typeof aVal === 'number' && typeof bVal === 'number') {
				return dir === 'asc' ? aVal - bVal : bVal - aVal;
			}

			// String comparison (case-insensitive)
			const aStr = String(aVal).toLowerCase();
			const bStr = String(bVal).toLowerCase();
			const cmp = aStr.localeCompare(bStr);
			return dir === 'asc' ? cmp : -cmp;
		});

		return sorted;
	});

	// matchIndices from worker (only meaningful in highlight mode)
	const matchIndices = $derived(searchModeFilter || !searchQuery ? [] : computedMatchIndices);

	// Notify parent of match info changes
	$effect(() => {
		if (onMatchInfo) {
			onMatchInfo({
				matchCount: matchIndices.length,
				totalCount: displayEvents.length,
				matchIndices
			});
		}
	});

	// Check if a row matches the search (for highlight mode row background)
	// No caching needed - virtual table only renders visible rows (~30-50)
	// and the match check is fast (simple string search)
	function isRowMatch(entry: any): boolean {
		if (!isHighlightMode) return false;
		return entryMatchesSearch(entry, lowerSearchQuery, visibleFieldNames);
	}

	// Check if a row index is the current match (for navigation highlighting)
	function isCurrentMatch(index: number): boolean {
		if (currentMatchIndex < 0 || currentMatchIndex >= matchIndices.length) return false;
		return matchIndices[currentMatchIndex] === index;
	}

	// Single-pass HTML escape using character codes (faster than multiple replace calls)
	function escapeHtml(str: string): string {
		let result = '';
		const len = str.length;
		for (let i = 0; i < len; i++) {
			const char = str.charCodeAt(i);
			switch (char) {
				case 38: // &
					result += '&amp;';
					break;
				case 60: // <
					result += '&lt;';
					break;
				case 62: // >
					result += '&gt;';
					break;
				case 34: // "
					result += '&quot;';
					break;
				case 39: // '
					result += '&#039;';
					break;
				default:
					result += str[i];
			}
		}
		return result;
	}

	// Optimized: Get highlighted HTML for a cell value
	// Returns empty string for no highlight, HTML string when highlighting
	function getHighlightedContent(value: any): string {
		if (value == null) return '';
		const str = typeof value === 'string' ? value : String(value);

		const query = lowerSearchQuery;
		const lowerStr = str.toLowerCase();
		const idx = lowerStr.indexOf(query);

		if (idx === -1) return escapeHtml(str);

		// Build highlighted string - minimize string concatenations
		const queryLen = searchQuery.length;
		return (
			escapeHtml(str.slice(0, idx)) +
			'<mark class="bg-yellow-500/50 text-inherit rounded-sm">' +
			escapeHtml(str.slice(idx, idx + queryLen)) +
			'</mark>' +
			escapeHtml(str.slice(idx + queryLen))
		);
	}

	/**
	 * Render cell value with hook support.
	 * Checks for custom cell renderers before falling back to default rendering.
	 *
	 * No caching is used because:
	 * - Virtual table only renders visible rows (~30-50 at a time)
	 * - String highlight computation is fast (<1ms per cell)
	 * - Avoids memory growth in long-running sessions
	 * - Prevents stale data if values update
	 *
	 * @param entry - Raw entry object
	 * @param field - Field definition with fullName and other metadata
	 * @param column - TableColumn for hook matching (optional, for future use)
	 */
	function renderCellValue(
		entry: any,
		field: any,
		column?: TableColumn
	): { html: string } | string {
		const value = entry[field.fullName];

		// Check for cell hooks (future use)
		if (hookRegistry?.cellHooks && column) {
			// Wrap entry for hook compatibility
			const enrichedRow: EnrichedRow = {
				data: entry,
				enrichments: {},
				status: {}
			};
			for (const hook of hookRegistry.cellHooks) {
				if (hook.match(column)) {
					const result = hook.render(value, enrichedRow, column);
					return typeof result === 'string' ? { html: escapeHtml(result) } : result;
				}
			}
		}

		// Default rendering - compute highlight on demand
		if (shouldHighlightText) {
			return { html: getHighlightedContent(value) };
		}
		return value ?? '';
	}

	/** Checks if a field should be visible based on its flags */
	function visible(flags: number | undefined): boolean {
		if (!flags) return true;
		// if ((flags & 0x0004) !== 0) return false; // hidden
		if ((flags & 0x0002) !== 0) return false; // container
		if ((flags & 0x0001) !== 0) return false; // empty
		return true;
	}

	// gadget context is retrieved at the top of the script

	let env = $derived(environments[page.params.env || '']);

	// Reference to VirtualTableBody for scrolling
	let virtualTableRef: { scrollToIndex: (index: number) => void } | undefined = $state();

	// Expose scroll function to parent
	$effect(() => {
		if (onScrollToIndex && virtualTableRef) {
			onScrollToIndex((index: number) => {
				virtualTableRef?.scrollToIndex(index);
			});
		}
	});

	// Wrap events in EnrichedRow structure for hook support (only when hooks are present)
	const wrappedRows = $derived.by(() => {
		// Only wrap rows if there are row hooks that need them
		if (!hookRegistry?.rowHooks?.length) return [];
		return wrapRowsForEnrichment(displayEvents);
	});

	// Handle visibility-based row processing for hooks
	function handleVisibleRangeChange(start: number, end: number) {
		if (!hookRegistry?.rowHooks?.length) return;

		const visibleRows = wrappedRows.slice(start, end);
		const sortedHooks = [...hookRegistry.rowHooks].sort(
			(a, b) => (a.priority || 0) - (b.priority || 0)
		);

		// Process async - don't block rendering
		for (const hook of sortedHooks) {
			hook.process(visibleRows, allColumns).catch((err) => {
				console.error(`Row hook ${hook.id} failed:`, err);
			});
		}
	}

	// All toggleable fields (filtered by runtime/flags but not user visibility)
	const toggleableFields = $derived(
		ds.fields
			.filter(
				/** @param {any} field */
				(field: any) => {
					if (env?.runtime === 'grpc-ig') {
						if (field.tags?.indexOf('kubernetes') >= 0) return false;
					}
					if (field.annotations['columns.hidden'] === 'true') {
						return false;
					}
					return visible(field.flags);
				}
			)
			.sort(
				/**
				 * @param {any} a
				 * @param {any} b
				 */
				(a: any, b: any) => {
					return (a.order || 0) - (b.order || 0);
				}
			)
	);

	// Fields that are currently visible (respecting user visibility settings)
	const visibleFields = $derived(
		toggleableFields.filter((field: any) => isColumnVisible(field.fullName))
	);

	// Field names for search matching (cached for performance)
	const visibleFieldNames = $derived(visibleFields.map((f: any) => f.fullName));

	// Merge gadget columns with hook columns
	const allColumns = $derived.by(() => {
		const gadgetCols = visibleFields.map((f: any) => gadgetFieldToColumn(f, env));
		const hookCols = hookRegistry?.columnHooks.flatMap((h) => h.columns) || [];
		return [...gadgetCols, ...hookCols].sort((a, b) => (a.order || 0) - (b.order || 0));
	});

	// Convert visibleFields to columns format for VirtualTableBody
	const columns = $derived(
		visibleFields.map((field: any) => ({
			key: field.fullName,
			label: field.fullName,
			description: field.annotations?.description,
			width: field.annotations?.['columns.width']
				? parseInt(field.annotations['columns.width'], 10)
				: undefined,
			minWidth: field.annotations?.['columns.minwidth']
				? parseInt(field.annotations['columns.minwidth'], 10)
				: undefined,
			maxWidth: field.annotations?.['columns.maxwidth']
				? parseInt(field.annotations['columns.maxwidth'], 10)
				: undefined,
			align: getColumnAlignment(field)
		}))
	);

	/** Opens inspector with the selected row data */
	function inspect(data: any) {
		const snapshot = { fields: $state.snapshot(ds.fields), entry: $state.snapshot(data) };
		gadgetContext.inspect = snapshot;
	}

	/**
	 * Handle copy event from VirtualTableBody.
	 * Formats selected rows as CSV or JSON based on settings and copies to clipboard.
	 */
	function handleCopy(event: {
		items: any[];
		indices: number[];
		columns: { key: string; label: string }[];
		excludeHeaders: boolean;
	}) {
		const format = (configuration.get('copyFormat') as string) || 'csv';
		const fieldNames = visibleFields.map((f: any) => f.fullName);

		let text: string;

		if (format === 'json') {
			// JSON format: array of objects with only visible fields
			const data = event.items.map((item) => {
				const obj: Record<string, any> = {};
				for (const fieldName of fieldNames) {
					obj[fieldName] = item[fieldName];
				}
				return obj;
			});
			text = JSON.stringify(data, null, 2);
		} else {
			// CSV format: Excel/Google Sheets compatible
			const rows: string[] = [];

			// Add header row unless Alt was held
			if (!event.excludeHeaders) {
				rows.push(fieldNames.map(escapeCSVField).join('\t'));
			}

			// Add data rows
			for (const item of event.items) {
				const values = fieldNames.map((fieldName: string) => {
					const value = item[fieldName];
					return escapeCSVField(value == null ? '' : String(value));
				});
				rows.push(values.join('\t'));
			}

			text = rows.join('\n');
		}

		navigator.clipboard.writeText(text).catch((err) => {
			console.error('Failed to copy to clipboard:', err);
		});
	}

	/**
	 * Escape a field value for CSV format.
	 * Uses tab-separated values for better Excel/Sheets compatibility.
	 * Quotes fields containing tabs, newlines, or quotes.
	 */
	function escapeCSVField(value: string): string {
		// If value contains tab, newline, or double quote, wrap in quotes and escape quotes
		if (value.includes('\t') || value.includes('\n') || value.includes('"')) {
			return '"' + value.replace(/"/g, '""') + '"';
		}
		return value;
	}
</script>

<div class="gadget-table flex h-full flex-col overflow-hidden border-t-1 border-gray-500">
	<!-- Datasource header (name + menu) -->
	{#if showHeader}
		<div
			class="flex h-10 flex-row items-center bg-gray-950 p-2 text-base font-normal flex-shrink-0"
		>
			<div class="pr-2">{@html Table}</div>
			<h2 class="px-2">{ds.name}</h2>
			<div class="flex-1"></div>
			<div class="relative">
				<button
					bind:this={menuButton}
					class="pl-2 hover:text-white transition-colors"
					onclick={() => (menuOpen = !menuOpen)}
					title="Column visibility"
					aria-label="Toggle column visibility menu"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					aria-controls="column-menu"
				>
					{@html Dots}
				</button>
				{#if menuOpen}
					<div
						id="column-menu"
						role="menu"
						aria-label="Column visibility options"
						class="absolute right-0 top-full mt-1 z-50 min-w-48 max-h-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl"
					>
						<div
							class="px-3 py-2 text-xs font-semibold text-gray-400 uppercase border-b border-gray-700"
						>
							Columns
						</div>
						<div class="py-1" role="group" aria-label="Column toggles">
							{#each toggleableFields as field}
								<label
									class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 cursor-pointer text-sm"
									role="menuitemcheckbox"
									aria-checked={isColumnVisible(field.fullName)}
								>
									<input
										type="checkbox"
										checked={isColumnVisible(field.fullName)}
										onchange={() => toggleColumnVisibility(field.fullName)}
										class="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
									/>
									<span class="text-gray-200 truncate" title={field.fullName}>{field.fullName}</span
									>
								</label>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Virtualized table -->
	<div class="flex-1 overflow-hidden">
		{#key `${shouldHighlightText}-${searchModeFilter}-${lowerSearchQuery}`}
			<VirtualTableBody
				bind:this={virtualTableRef}
				items={displayEvents}
				{columns}
				rowHeight={24}
				class="text-sm"
				rowClass={(entry, index, isFocused, isSelected) => {
					const isCurrent = isCurrentMatch(index);
					const isMatch = isRowMatch(entry);
					return `cursor-pointer hover:bg-gray-800 ${isCurrent ? 'search-current-match' : isMatch ? 'search-highlight-row' : ''}`;
				}}
				onrowclick={(entry) => inspect(entry)}
				onVisibleRangeChange={handleVisibleRangeChange}
				oncopy={handleCopy}
			>
				{#snippet header(cols, { startResize, resizingIndex, setHeaderRow })}
					<tr class="bg-gray-950" use:setHeaderRow>
						{#each visibleFields as field, i}
							{@const isSorted = sortColumn === field.fullName}
							<th
								class="relative border-r border-r-gray-600 p-2 text-xs font-normal last:border-r-0 overflow-hidden"
								class:cursor-pointer={canSort}
								class:hover:bg-gray-800={canSort}
								onclick={() => handleColumnSort(field.fullName)}
							>
								<div
									title={canSort
										? `${field.annotations?.description || field.fullName} (click to sort)`
										: field.annotations?.description}
									class="uppercase overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-1"
								>
									<span class="overflow-hidden text-ellipsis">{field.fullName}</span>
									{#if isSorted && canSort}
										<span class="text-blue-400 flex-shrink-0">
											{#if sortDirection === 'asc'}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<polyline points="18 15 12 9 6 15"></polyline>
												</svg>
											{:else}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<polyline points="6 9 12 15 18 9"></polyline>
												</svg>
											{/if}
										</span>
									{/if}
								</div>
								{#if i < visibleFields.length - 1}
									<div
										class="resize-handle"
										class:active={resizingIndex === i}
										onpointerdown={(e) => startResize(e, i)}
									></div>
								{/if}
							</th>
						{/each}
					</tr>
				{/snippet}
				{#snippet row(entry, index)}
					{#each visibleFields as field, i}
						{@const cellValue = renderCellValue(entry, field, allColumns[i])}
						<td
							class="border-r border-r-gray-600 px-2 py-0 text-nowrap text-ellipsis last:border-r-0 font-mono text-xs text-gray-200"
							class:text-right={columns[i]?.align === 'right'}
							class:text-center={columns[i]?.align === 'center'}
						>
							{#if typeof cellValue === 'object' && 'html' in cellValue}
								{@html cellValue.html}
							{:else}
								{cellValue}
							{/if}
						</td>
					{/each}
				{/snippet}
			</VirtualTableBody>
		{/key}
	</div>
</div>

<style>
	:global(.search-highlight-row) {
		background-color: rgb(113 63 18 / 0.3);
	}
	:global(.search-highlight-row:hover) {
		background-color: rgb(113 63 18 / 0.5);
	}
	:global(.search-current-match) {
		background-color: rgb(234 88 12 / 0.5);
	}
	:global(.search-current-match:hover) {
		background-color: rgb(234 88 12 / 0.6);
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
</style>
