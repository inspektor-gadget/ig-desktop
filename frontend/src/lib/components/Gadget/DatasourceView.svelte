<script lang="ts">
	import Table, { type TableMenuController } from './Table.svelte';
	import Chart from './Chart.svelte';
	import SnapshotTimeline from './SnapshotTimeline.svelte';
	import TableIcon from '$lib/icons/table-column.svg?raw';
	import ChartIcon from '$lib/icons/chart.svg?raw';
	import Dots from '$lib/icons/dots-vertical.svg?raw';
	import ChevronLeft from '$lib/icons/chevron-left.svg?raw';
	import ChevronRight from '$lib/icons/chevron-right.svg?raw';
	import ArrowRotateLeft from '$lib/icons/arrow-rotate-left.svg?raw';
	import InfoIcon from '$lib/icons/info-small.svg?raw';
	import { preferences } from '$lib/shared/preferences.svelte';
	import { getArraySnapshots } from '$lib/handlers/gadget.handler.svelte';
	import type { Datasource } from '$lib/types/charts';
	import type { EventRingBuffer } from '$lib/utils/ring-buffer';

	interface Props {
		ds: Datasource;
		instanceID: string;
		events?: EventRingBuffer<Record<string, unknown>>;
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
		isRunning?: boolean;
	}

	let {
		ds,
		instanceID,
		events,
		eventVersion = 0,
		searchQuery = '',
		searchModeFilter = true,
		searchHighlightInFilterMode = false,
		onMatchInfo,
		currentMatchIndex = -1,
		onScrollToIndex,
		isRunning = true
	}: Props = $props();

	// Check if this datasource supports metrics visualization
	const hasMetrics = $derived(ds.annotations?.['metrics.collect'] === 'true');

	// Tab state - persist per datasource
	const prefKey = $derived(`datasource.${ds.name}.view`);

	// Initialize tab based on whether metrics are available
	// Use $state with initial value calculated from annotations
	const initialMetrics = ds.annotations?.['metrics.collect'] === 'true';
	let activeTab = $state<'chart' | 'table'>(
		initialMetrics
			? (preferences.getDefault(`datasource.${ds.name}.view`, 'chart') as 'chart' | 'table')
			: 'table'
	);

	function setTab(tab: 'chart' | 'table') {
		activeTab = tab;
		preferences.set(prefKey, tab);
	}

	// Snapshot navigation state for array datasources - now supports multi-selection
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Using $state with Set for performance; reassignment-based reactivity is sufficient here
	let selectedSnapshotIndices = $state<Set<number>>(new Set([0])); // Default: latest selected
	let lastSelectedIndex = $state(0); // For shift-click range selection
	let isPinned = $state(false); // true when user manually selected a non-latest snapshot

	// Track custom sorting state (for showing warning about partial results)
	let customSortColumn = $state<string | null>(null);
	let sortResetTrigger = $state(0);

	// Column visibility menu state
	let menuOpen = $state(false);
	let menuButton: HTMLButtonElement | undefined = $state();
	let tableMenuController = $state<TableMenuController | null>(null);

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

	function handleSortChange(column: string | null) {
		customSortColumn = column;
	}

	function resetSort() {
		sortResetTrigger++;
	}

	// Get snapshots for this datasource
	const snapshots = $derived(getArraySnapshots(instanceID, ds.name));
	const hasSnapshots = $derived(snapshots.length > 0);
	const snapshotCount = $derived(snapshots.length);

	// Track the batchIds we're viewing to maintain position when new snapshots arrive
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Using $state with Set for performance
	let pinnedBatchIds = $state<Set<number>>(new Set());

	// When pinned and new snapshots arrive, adjust indices to keep viewing the same snapshots
	$effect(() => {
		if (isPinned && pinnedBatchIds.size > 0 && snapshots.length > 0) {
			const newIndices = new Set<number>();
			for (const batchId of pinnedBatchIds) {
				const newIndex = snapshots.findIndex((s) => s.batchId === batchId);
				if (newIndex !== -1) {
					newIndices.add(newIndex);
				}
			}
			if (newIndices.size > 0) {
				selectedSnapshotIndices = newIndices;
			}
		}
	});

	// Ensure selected indices stay in bounds
	$effect(() => {
		if (snapshotCount > 0) {
			const validIndices = new Set<number>();
			for (const idx of selectedSnapshotIndices) {
				if (idx < snapshotCount) {
					validIndices.add(idx);
				}
			}
			// If all indices were out of bounds, select the latest
			if (validIndices.size === 0) {
				validIndices.add(0);
			}
			if (validIndices.size !== selectedSnapshotIndices.size) {
				selectedSnapshotIndices = validIndices;
			}
		}
	});

	// Get events for selected snapshots (for table view)
	// Merges data from all selected snapshots
	const snapshotEvents = $derived.by((): Record<string, unknown>[] | undefined => {
		if (!hasSnapshots) {
			// No snapshots, return undefined to signal Table should use events prop
			return undefined;
		}

		// If only one snapshot selected, return its data directly (common case)
		if (selectedSnapshotIndices.size === 1) {
			const index = selectedSnapshotIndices.values().next().value as number;
			const snapshot = snapshots[index];
			return snapshot ? snapshot.data : [];
		}

		// Merge data from all selected snapshots
		// Sort indices to maintain chronological order (higher index = older)
		const sortedIndices = Array.from(selectedSnapshotIndices).sort((a, b) => b - a);
		const mergedData: Record<string, unknown>[] = [];

		for (const index of sortedIndices) {
			const snapshot = snapshots[index];
			if (snapshot) {
				mergedData.push(...snapshot.data);
			}
		}

		return mergedData;
	});

	// Get total event count across selected snapshots
	const selectedEventCount = $derived.by(() => {
		let count = 0;
		for (const index of selectedSnapshotIndices) {
			const snapshot = snapshots[index];
			if (snapshot) {
				count += snapshot.data.length;
			}
		}
		return count;
	});

	// Navigation handlers
	function goToLatest() {
		selectedSnapshotIndices = new Set([0]);
		lastSelectedIndex = 0;
		isPinned = false;
		pinnedBatchIds = new Set();
	}

	// Handle snapshot selection with modifier keys
	function selectSnapshot(index: number, event: MouseEvent | KeyboardEvent) {
		const isCtrlOrCmd = event.ctrlKey || event.metaKey;
		const isShift = event.shiftKey;

		if (isShift && lastSelectedIndex !== null) {
			// Shift+click: select range from last selected to current
			const start = Math.min(lastSelectedIndex, index);
			const end = Math.max(lastSelectedIndex, index);
			const newSelection = new Set<number>();
			for (let i = start; i <= end; i++) {
				newSelection.add(i);
			}
			selectedSnapshotIndices = newSelection;
		} else if (isCtrlOrCmd) {
			// Ctrl/Cmd+click: toggle individual selection
			const newSelection = new Set(selectedSnapshotIndices);
			if (newSelection.has(index)) {
				// Don't allow deselecting the last item
				if (newSelection.size > 1) {
					newSelection.delete(index);
				}
			} else {
				newSelection.add(index);
			}
			selectedSnapshotIndices = newSelection;
			lastSelectedIndex = index;
		} else {
			// Regular click: single selection
			selectedSnapshotIndices = new Set([index]);
			lastSelectedIndex = index;
		}

		// Update pinned state based on selection
		// Only unpinned if we have exactly index 0 selected
		if (selectedSnapshotIndices.size === 1 && selectedSnapshotIndices.has(0)) {
			isPinned = false;
			pinnedBatchIds = new Set();
		} else {
			isPinned = true;
			// Track batch IDs for all selected snapshots
			const newPinnedIds = new Set<number>();
			for (const idx of selectedSnapshotIndices) {
				const batchId = snapshots[idx]?.batchId;
				if (batchId !== undefined) {
					newPinnedIds.add(batchId);
				}
			}
			pinnedBatchIds = newPinnedIds;
		}
	}

	// Select all snapshots
	function selectAll() {
		const allIndices = new Set<number>();
		for (let i = 0; i < snapshotCount; i++) {
			allIndices.add(i);
		}
		selectedSnapshotIndices = allIndices;
		isPinned = true;
		// Track batch IDs for all snapshots
		const newPinnedIds = new Set<number>();
		for (const snapshot of snapshots) {
			newPinnedIds.add(snapshot.batchId);
		}
		pinnedBatchIds = newPinnedIds;
	}

	// Get current single selected index (only valid when size === 1)
	const singleSelectedIndex = $derived(
		selectedSnapshotIndices.size === 1
			? (selectedSnapshotIndices.values().next().value as number)
			: -1
	);

	// Navigation for single selection mode
	function goToNewerSnapshot() {
		if (singleSelectedIndex > 0) {
			const newIndex = singleSelectedIndex - 1;
			selectedSnapshotIndices = new Set([newIndex]);
			lastSelectedIndex = newIndex;
			// Update pinned state
			if (newIndex === 0) {
				isPinned = false;
				pinnedBatchIds = new Set();
			} else {
				isPinned = true;
				pinnedBatchIds = new Set([snapshots[newIndex]?.batchId].filter((id) => id !== undefined));
			}
		}
	}

	function goToOlderSnapshot() {
		if (singleSelectedIndex >= 0 && singleSelectedIndex < snapshotCount - 1) {
			const newIndex = singleSelectedIndex + 1;
			selectedSnapshotIndices = new Set([newIndex]);
			lastSelectedIndex = newIndex;
			isPinned = true;
			pinnedBatchIds = new Set([snapshots[newIndex]?.batchId].filter((id) => id !== undefined));
		}
	}

	// Handle drag range selection from timeline
	function selectRange(startIndex: number, endIndex: number) {
		const newSelection = new Set<number>();
		for (let i = startIndex; i <= endIndex; i++) {
			newSelection.add(i);
		}
		selectedSnapshotIndices = newSelection;
		lastSelectedIndex = endIndex;

		// Update pinned state
		if (newSelection.size === 1 && newSelection.has(0)) {
			isPinned = false;
			pinnedBatchIds = new Set();
		} else {
			isPinned = true;
			const newPinnedIds = new Set<number>();
			for (const idx of newSelection) {
				const batchId = snapshots[idx]?.batchId;
				if (batchId !== undefined) {
					newPinnedIds.add(batchId);
				}
			}
			pinnedBatchIds = newPinnedIds;
		}
	}
</script>

<div class="flex h-full flex-col">
	<!-- Header with tabs -->
	<div
		class="sticky top-0 left-0 z-20 flex h-10 flex-shrink-0 flex-row items-center border-t border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-2 text-base font-normal"
	>
		{#if hasMetrics}
			<div class="flex h-6 w-6 items-center justify-center pr-2">
				{#if activeTab === 'chart'}
					{@html ChartIcon}
				{:else}
					{@html TableIcon}
				{/if}
			</div>
		{:else}
			<div class="flex h-6 w-6 items-center justify-center pr-2">{@html TableIcon}</div>
		{/if}

		<h2 class="px-1">{ds.name}</h2>

		<div class="flex-1"></div>

		{#if hasMetrics}
			<div class="flex flex-row rounded-md bg-gray-100 dark:bg-gray-900 p-0.5">
				<button
					class="flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors"
					class:bg-gray-300={activeTab === 'chart'}
					class:dark:bg-gray-700={activeTab === 'chart'}
					class:text-gray-800={activeTab === 'chart'}
					class:dark:text-gray-200={activeTab === 'chart'}
					class:text-gray-500={activeTab !== 'chart'}
					class:hover:text-gray-700={activeTab !== 'chart'}
					class:dark:hover:text-gray-300={activeTab !== 'chart'}
					onclick={() => setTab('chart')}
				>
					{@html ChartIcon}
					<span>Chart</span>
				</button>
				<button
					class="flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors"
					class:bg-gray-300={activeTab === 'table'}
					class:dark:bg-gray-700={activeTab === 'table'}
					class:text-gray-800={activeTab === 'table'}
					class:dark:text-gray-200={activeTab === 'table'}
					class:text-gray-500={activeTab !== 'table'}
					class:hover:text-gray-700={activeTab !== 'table'}
					class:dark:hover:text-gray-300={activeTab !== 'table'}
					onclick={() => setTab('table')}
				>
					{@html TableIcon}
					<span>Table</span>
				</button>
			</div>
		{/if}

		<div class="relative">
			<button
				bind:this={menuButton}
				class="pl-2 hover:text-gray-900 dark:hover:text-white transition-colors"
				class:text-gray-500={activeTab !== 'table'}
				class:hover:text-gray-700={activeTab !== 'table'}
				class:dark:hover:text-gray-300={activeTab !== 'table'}
				onclick={() => (menuOpen = !menuOpen)}
				title="Column visibility"
				aria-label="Toggle column visibility menu"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				aria-controls="column-menu"
				disabled={activeTab !== 'table'}
			>
				{@html Dots}
			</button>
			{#if menuOpen && activeTab === 'table' && tableMenuController}
				<div
					id="column-menu"
					role="menu"
					aria-label="Column visibility options"
					class="absolute right-0 top-full mt-1 z-50 min-w-48 max-h-80 overflow-y-auto rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl"
				>
					<div
						class="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700"
					>
						Columns
					</div>
					<div class="py-1" role="group" aria-label="Column toggles">
						{#each tableMenuController.toggleableFields as field (field.fullName)}
							<label
								class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-sm"
								role="menuitemcheckbox"
								aria-checked={tableMenuController.isColumnVisible(field.fullName)}
							>
								<input
									type="checkbox"
									checked={tableMenuController.isColumnVisible(field.fullName)}
									onchange={() => tableMenuController?.toggleColumnVisibility(field.fullName)}
									class="rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
								/>
								<span class="text-gray-800 dark:text-gray-200 truncate" title={field.fullName}>{field.fullName}</span>
							</label>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Snapshot timeline and navigation (for array datasources in table view) -->
	{#if activeTab === 'table' && hasSnapshots && snapshotCount > 1}
		<!-- Mini timeline chart -->
		<SnapshotTimeline
			{snapshots}
			selectedIndices={selectedSnapshotIndices}
			onSelect={selectSnapshot}
			onRangeSelect={selectRange}
		/>

		<!-- Navigation bar -->
		<div
			class="flex flex-shrink-0 items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2 py-1 text-xs"
		>
			<div class="flex items-center gap-2">
				<!-- Back/forth navigation for single selection -->
				{#if selectedSnapshotIndices.size === 1}
					<div class="flex items-center gap-1">
						<button
							class="rounded p-0.5 transition-colors disabled:opacity-30"
							class:text-gray-500={singleSelectedIndex > 0}
							class:dark:text-gray-400={singleSelectedIndex > 0}
							class:hover:bg-gray-200={singleSelectedIndex > 0}
							class:dark:hover:bg-gray-700={singleSelectedIndex > 0}
							class:hover:text-gray-800={singleSelectedIndex > 0}
							class:dark:hover:text-gray-200={singleSelectedIndex > 0}
							disabled={singleSelectedIndex === 0}
							onclick={goToNewerSnapshot}
							title="Newer snapshot"
						>
							{@html ChevronLeft}
						</button>
						<span class="min-w-16 text-center text-gray-500 dark:text-gray-400">
							{singleSelectedIndex + 1} / {snapshotCount}
						</span>
						<button
							class="rounded p-0.5 transition-colors disabled:opacity-30"
							class:text-gray-500={singleSelectedIndex < snapshotCount - 1}
							class:dark:text-gray-400={singleSelectedIndex < snapshotCount - 1}
							class:hover:bg-gray-200={singleSelectedIndex < snapshotCount - 1}
							class:dark:hover:bg-gray-700={singleSelectedIndex < snapshotCount - 1}
							class:hover:text-gray-800={singleSelectedIndex < snapshotCount - 1}
							class:dark:hover:text-gray-200={singleSelectedIndex < snapshotCount - 1}
							disabled={singleSelectedIndex >= snapshotCount - 1}
							onclick={goToOlderSnapshot}
							title="Older snapshot"
						>
							{@html ChevronRight}
						</button>
					</div>
				{:else}
					<!-- Multi-selection info -->
					<span class="text-gray-500 dark:text-gray-400">
						{selectedSnapshotIndices.size} of {snapshotCount} snapshots
					</span>
				{/if}

				<!-- Select all button -->
				{#if selectedSnapshotIndices.size < snapshotCount}
					<button
						class="rounded bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-300 dark:hover:bg-gray-600 hover:text-gray-900 dark:hover:text-gray-100"
						onclick={selectAll}
						title="Select all snapshots (merge all data)"
					>
						Select All
					</button>
				{/if}
			</div>

			<!-- Center section: sort warning or tip -->
			<div class="mx-2 min-w-0 flex-1 overflow-hidden text-center">
				{#if customSortColumn}
					<div
						class="inline-flex items-center gap-1.5 rounded bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-amber-800 dark:text-amber-200"
						title="Server-side filtering may have limited the results. The sorted view shows only the events received, not necessarily all matching events."
					>
						<span class="h-3.5 w-3.5 flex-shrink-0">{@html InfoIcon}</span>
						<span class="truncate">Sorted locally (results may be partial)</span>
						<button
							class="ml-1 rounded px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-100 transition-colors hover:bg-amber-200 dark:hover:bg-amber-800/50"
							onclick={resetSort}
							title="Reset sorting to default order"
						>
							Reset
						</button>
					</div>
				{:else if selectedSnapshotIndices.size === 1}
					<span class="truncate text-gray-500 dark:text-gray-600"> Drag to select range, Ctrl+click to toggle </span>
				{/if}
			</div>

			<div class="flex flex-shrink-0 items-center gap-2 text-gray-500 dark:text-gray-500">
				<!-- Event count info -->
				<span>
					{selectedEventCount} events
					{#if selectedSnapshotIndices.size > 1}
						(merged)
					{/if}
				</span>

				<!-- Return to latest button when pinned -->
				{#if isPinned}
					<button
						class="flex items-center gap-1 rounded bg-green-700 px-2 py-0.5 text-green-100 transition-colors hover:bg-green-600"
						onclick={goToLatest}
						title="Return to latest snapshot"
					>
						<span class="h-4 w-4">{@html ArrowRotateLeft}</span>
						<span>Latest</span>
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Content - Use hidden class instead of {#if} to avoid recreating components on tab switch -->
	{#if hasMetrics}
		<div class="min-h-0 flex-1" class:hidden={activeTab !== 'chart'}>
			<Chart {ds} {events} {eventVersion} />
		</div>
	{/if}
	<div class="min-h-0 flex-1" class:hidden={activeTab !== 'table'}>
		<Table
			{ds}
			events={hasSnapshots ? undefined : events}
			snapshotData={snapshotEvents}
			{eventVersion}
			{searchQuery}
			{searchModeFilter}
			{searchHighlightInFilterMode}
			{onMatchInfo}
			{currentMatchIndex}
			{onScrollToIndex}
			{isRunning}
			showHeader={false}
			onSortChange={handleSortChange}
			sortReset={sortResetTrigger}
			onMenuController={(ctrl) => (tableMenuController = ctrl)}
		/>
	</div>
</div>
