<script lang="ts">
	import type { FlameNode, FlamegraphRenderNode, GroupableField } from '$lib/types/flamegraph';
	import { getPercentage } from '$lib/utils/flamegraphConfig';
	import { clickOutside } from '$lib/utils/click-outside';
	import SearchIcon from '$lib/icons/search-small.svg?raw';
	import CloseIcon from '$lib/icons/close-small.svg?raw';
	import ChevronDown from '$lib/icons/chevron-down.svg?raw';

	interface Props {
		data: FlameNode | null;
		/** Available groupable fields from datasource */
		groupableFields?: GroupableField[];
		/** Currently active group fields */
		activeGroupFields?: Set<string>;
		/** Callback when group fields change */
		onGroupChange?: (fields: Set<string>) => void;
	}

	let {
		data,
		groupableFields = [],
		activeGroupFields = new Set(),
		onGroupChange
	}: Props = $props();

	// Container dimensions - use manual ResizeObserver with rAF to avoid loop warnings
	let containerWidth = $state(800);
	let containerRef: HTMLDivElement | undefined = $state();
	let scrollContainerRef: HTMLDivElement | undefined = $state();

	// ResizeObserver with requestAnimationFrame to prevent "ResizeObserver loop" errors
	// We observe the scroll container and use clientWidth to account for scrollbar width
	$effect(() => {
		if (!scrollContainerRef) return;

		// Initialize from current width (clientWidth excludes scrollbar)
		containerWidth = scrollContainerRef.clientWidth || 800;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// Wrap in rAF to avoid "ResizeObserver loop completed with undelivered notifications"
				// Use clientWidth instead of contentRect.width to account for vertical scrollbar
				requestAnimationFrame(() => {
					containerWidth = (entry.target as HTMLElement).clientWidth || 800;
				});
			}
		});

		resizeObserver.observe(scrollContainerRef);

		return () => {
			resizeObserver.disconnect();
		};
	});

	// Zoom/navigation state
	let zoomedNode = $state<FlameNode | null>(null);
	let zoomHistory = $state<FlameNode[]>([]);

	// Search state
	let searchQuery = $state('');
	let searchRegex = $state<RegExp | null>(null);
	let caseSensitive = $state(false);
	let searchInputRef: HTMLInputElement | undefined = $state();

	// Tooltip state
	let tooltipNode = $state<FlameNode | null>(null);
	let tooltipDepth = $state<number>(0); // Track depth to avoid proxy comparison issues
	let tooltipPosition = $state({ x: 0, y: 0 });

	// Group by dropdown state
	let groupMenuOpen = $state(false);
	let groupMenuButton: HTMLButtonElement | undefined = $state();

	// Toggle group field selection
	function toggleGroupField(fieldName: string) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Creating a copy for immutable update
		const newFields = new Set(activeGroupFields);
		if (newFields.has(fieldName)) {
			newFields.delete(fieldName);
		} else {
			newFields.add(fieldName);
		}
		onGroupChange?.(newFields);
	}

	// Count of active group fields
	const activeGroupCount = $derived(activeGroupFields.size);

	// Flamegraph row rendering configuration
	const ROW_HEIGHT = 20; // Standard row height balancing readability with data density
	const ROW_GAP = 1; // Minimal gap for visual separation without wasting space
	const MIN_WIDTH_PX = 1; // Minimum frame width to remain visible (1px hairline)
	const TEXT_MIN_WIDTH_PX = 35; // ~5 characters at 7px monospace font width

	// Computed display data (zoom applied)
	const displayRoot = $derived(zoomedNode || data);
	const totalValue = $derived(data?.value || 0);

	// Flatten hierarchy for rendering
	const renderNodes = $derived.by((): FlamegraphRenderNode[] => {
		if (!displayRoot || displayRoot.value === 0) return [];

		const nodes: FlamegraphRenderNode[] = [];
		const rootValue = displayRoot.value;

		function traverse(node: FlameNode, x: number, depth: number) {
			// Calculate width directly from node value relative to root
			const width = node.value / rootValue;

			// Skip nodes that are too narrow to render
			if (width * containerWidth < MIN_WIDTH_PX && depth > 0) return;

			const isHighlighted = searchRegex ? searchRegex.test(node.name) : false;
			nodes.push({ node, x, width, depth, isHighlighted });

			if (node.children && node.children.length > 0) {
				let childX = x;
				// Sort children by value descending for consistent ordering
				const sortedChildren = [...node.children].sort((a, b) => b.value - a.value);

				for (const child of sortedChildren) {
					const childWidth = child.value / rootValue;
					traverse(child, childX, depth + 1);
					childX += childWidth;
				}
			}
		}

		traverse(displayRoot, 0, 0);
		return nodes;
	});

	// Calculate max depth for SVG height
	const maxDepth = $derived(Math.max(...renderNodes.map((n) => n.depth), 0) + 1);
	const svgHeight = $derived(maxDepth * (ROW_HEIGHT + ROW_GAP) + 10);

	// Color generation based on function name (warm colors for flamegraph)
	function getColor(name: string): string {
		// Hash function name for consistent colors
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = (hash << 5) - hash + name.charCodeAt(i);
			hash |= 0;
		}
		// Warm color palette (orange-red range)
		const hue = 10 + Math.abs(hash % 50); // 10-60 (red-orange-yellow)
		const saturation = 65 + Math.abs((hash >> 8) % 25); // 65-90%
		const lightness = 50 + Math.abs((hash >> 16) % 15); // 50-65%
		return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
	}

	// Event handlers
	function handleClick(node: FlameNode, depth: number) {
		// Use depth check instead of object comparison to avoid $state proxy issues
		if (depth === 0 || node.name === 'all') return;
		zoomHistory = [...zoomHistory, zoomedNode || data!];
		zoomedNode = node;
	}

	function handleReset() {
		zoomHistory = [];
		zoomedNode = null;
	}

	function handleBack() {
		if (zoomHistory.length > 0) {
			// When history has only 1 entry, it's the original root (data) - return to unzoomed state
			// This avoids comparing $state proxy with raw prop which triggers state_proxy_equality_mismatch
			const returningToRoot = zoomHistory.length === 1;
			const prev = zoomHistory[zoomHistory.length - 1];
			zoomHistory = zoomHistory.slice(0, -1);
			zoomedNode = returningToRoot ? null : prev;
		}
	}

	function updateSearchRegex() {
		if (!searchQuery.trim()) {
			searchRegex = null;
			return;
		}
		try {
			searchRegex = new RegExp(searchQuery, caseSensitive ? '' : 'i');
		} catch {
			// Invalid regex - fall back to literal match
			const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			searchRegex = new RegExp(escaped, caseSensitive ? '' : 'i');
		}
	}

	function handleSearchInput() {
		updateSearchRegex();
	}

	function clearSearch() {
		searchQuery = '';
		searchRegex = null;
	}

	function toggleCaseSensitive() {
		caseSensitive = !caseSensitive;
		updateSearchRegex();
	}

	// Count matching samples (sum of leaf node values where the node name matches)
	const matchedSamples = $derived.by(() => {
		if (!searchRegex || !data) return 0;

		// For flamegraphs, we want to show % of samples in matching frames
		// Only count leaf nodes to avoid double-counting
		function sumMatchingLeaves(node: FlameNode): number {
			if (!node.children || node.children.length === 0) {
				// Leaf node
				return searchRegex!.test(node.name) ? node.value : 0;
			}
			// Non-leaf: sum children
			let childSum = 0;
			for (const child of node.children) {
				childSum += sumMatchingLeaves(child);
			}
			return childSum;
		}

		return sumMatchingLeaves(data);
	});

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (searchQuery) {
				clearSearch();
			} else {
				handleReset();
			}
			e.preventDefault();
		}
		if (e.key === 'Backspace' && !searchQuery && zoomHistory.length > 0) {
			handleBack();
			e.preventDefault();
		}
		if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
			e.preventDefault();
			searchInputRef?.focus();
		}
	}

	// Format large numbers
	function formatNumber(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
		return n.toLocaleString();
	}
</script>

<div
	class="flex h-full w-full flex-col relative outline-none overflow-hidden focus:outline-2 focus:outline-blue-500 focus:-outline-offset-2"
	bind:this={containerRef}
	onkeydown={handleKeydown}
	tabindex="0"
	role="application"
	aria-label="Flamegraph visualization"
>
	<!-- Controls bar -->
	<div
		class="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex-shrink-0"
	>
		<!-- Search box -->
		<div
			class="flex items-center gap-1 px-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md"
		>
			<span class="w-3.5 h-3.5 text-gray-400 flex-shrink-0">{@html SearchIcon}</span>
			<input
				bind:this={searchInputRef}
				type="text"
				placeholder="Search (regex)..."
				bind:value={searchQuery}
				oninput={handleSearchInput}
				aria-label="Search functions"
				class="border-none bg-transparent py-1.5 px-1 text-xs w-44 outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
			/>
			{#if searchQuery}
				<button
					onclick={clearSearch}
					title="Clear search"
					aria-label="Clear search"
					class="flex items-center justify-center w-4 h-4 p-0 border-none bg-transparent text-gray-400 cursor-pointer rounded hover:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
				>
					{@html CloseIcon}
				</button>
			{/if}
			<button
				class="py-0.5 px-1.5 border border-gray-300 dark:border-gray-600 rounded text-[10px] font-medium cursor-pointer bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 transition-all hover:bg-gray-200 dark:hover:bg-gray-600"
				class:!bg-blue-500={caseSensitive}
				class:!border-blue-500={caseSensitive}
				class:!text-white={caseSensitive}
				onclick={toggleCaseSensitive}
				title="Case sensitive (Ctrl+I)"
				aria-label="Toggle case sensitivity"
				aria-pressed={caseSensitive}
			>
				Aa
			</button>
		</div>

		<!-- Search match info -->
		{#if searchRegex && totalValue > 0}
			<span
				class="text-[11px] text-gray-500 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 py-0.5 px-2 rounded"
			>
				{formatNumber(matchedSamples)} / {formatNumber(totalValue)} samples ({getPercentage(
					matchedSamples,
					totalValue
				).toFixed(1)}%)
			</span>
		{/if}

		<!-- Group by dropdown -->
		{#if groupableFields.length > 0}
			<div
				class="relative"
				use:clickOutside={{ enabled: groupMenuOpen, onClickOutside: () => (groupMenuOpen = false) }}
			>
				<button
					bind:this={groupMenuButton}
					class="flex items-center gap-1 py-1 px-2 border rounded text-[11px] cursor-pointer transition-all hover:border-gray-400 {activeGroupCount >
					0
						? 'bg-blue-100 dark:bg-blue-900 border-blue-500 text-blue-700 dark:text-blue-300'
						: 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'}"
					onclick={() => (groupMenuOpen = !groupMenuOpen)}
					aria-haspopup="menu"
					aria-expanded={groupMenuOpen}
					aria-controls="group-menu"
				>
					Group by
					{#if activeGroupCount > 0}
						<span class="bg-blue-500 text-white text-[9px] py-px px-1.5 rounded-full font-semibold"
							>{activeGroupCount}</span
						>
					{/if}
					<span class="w-3 h-3 opacity-60 flex items-center">{@html ChevronDown}</span>
				</button>
				{#if groupMenuOpen}
					<div
						id="group-menu"
						role="menu"
						aria-label="Group by options"
						class="absolute top-full left-0 mt-1 min-w-52 max-h-70 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg z-50"
					>
						<div
							class="px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700"
						>
							Group by:
						</div>
						<div class="py-1" role="group" aria-label="Grouping field toggles">
							{#each groupableFields as field (field.fieldName)}
								{@const tooltipText = field.description
									? `${field.fieldName}\n${field.description}`
									: field.fieldName}
								<label
									class="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
									title={tooltipText}
								>
									<input
										type="checkbox"
										checked={activeGroupFields.has(field.fieldName)}
										onchange={() => toggleGroupField(field.fieldName)}
										class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 cursor-pointer"
									/>
									<div class="flex flex-col min-w-0">
										<span class="text-xs text-gray-700 dark:text-gray-200 truncate"
											>{field.label}</span
										>
										<span class="text-[10px] text-gray-400 dark:text-gray-500 truncate"
											>{field.fieldName}</span
										>
									</div>
								</label>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<div class="flex-1"></div>

		<!-- Zoom controls -->
		{#if zoomedNode || zoomHistory.length > 0}
			<button
				class="py-1 px-2.5 border border-gray-300 dark:border-gray-600 rounded text-[11px] cursor-pointer bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 transition-all hover:bg-gray-100 dark:hover:bg-gray-600 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
				onclick={handleBack}
				disabled={zoomHistory.length === 0}
				title="Go back (Backspace)"
			>
				Back
			</button>
			<button
				class="py-1 px-2.5 border border-gray-300 dark:border-gray-600 rounded text-[11px] cursor-pointer bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 transition-all hover:bg-gray-100 dark:hover:bg-gray-600 hover:border-gray-400"
				onclick={handleReset}
				title="Reset zoom (Escape)"
			>
				Reset
			</button>
		{/if}

		<!-- Zoom info -->
		<span
			class="text-[11px] text-gray-500 dark:text-gray-400 max-w-50 overflow-hidden text-ellipsis whitespace-nowrap"
		>
			{#if zoomedNode}
				Zoomed: <span class="font-mono text-gray-700 dark:text-gray-300">{zoomedNode.name}</span>
			{:else}
				Click to zoom
			{/if}
		</span>
	</div>

	<!-- SVG flamegraph -->
	{#if data && renderNodes.length > 0}
		<div class="flex-1 overflow-auto min-h-0" bind:this={scrollContainerRef}>
			<svg
				width={containerWidth}
				height={svgHeight}
				class="block"
				role="img"
				aria-label="Flamegraph chart"
			>
				{#each renderNodes as { node, x, width, depth, isHighlighted } (node.name + '-' + x.toFixed(6) + '-' + depth)}
					{@const xPx = x * containerWidth}
					{@const widthPx = Math.max(width * containerWidth - ROW_GAP, MIN_WIDTH_PX)}
					{@const yPx = depth * (ROW_HEIGHT + ROW_GAP)}
					{@const showText = widthPx >= TEXT_MIN_WIDTH_PX}
					{@const isRoot = depth === 0}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<g
						class="cursor-pointer transition-opacity duration-100"
						class:!cursor-default={isRoot}
						class:opacity-35={searchRegex && !isHighlighted}
						transform="translate({xPx}, {yPx})"
						onclick={() => handleClick(node, depth)}
						onmouseenter={(e) => {
							tooltipNode = node;
							tooltipDepth = depth;
							tooltipPosition = { x: e.clientX, y: e.clientY };
						}}
						onmousemove={(e) => {
							tooltipPosition = { x: e.clientX, y: e.clientY };
						}}
						onmouseleave={() => (tooltipNode = null)}
					>
						<rect
							width={widthPx}
							height={ROW_HEIGHT}
							fill={isRoot ? '#6b7280' : getColor(node.name)}
							rx="2"
							ry="2"
							class="hover:stroke-black dark:hover:stroke-white hover:stroke-1"
							class:!stroke-amber-400={isHighlighted}
							class:!stroke-2={isHighlighted}
						/>
						{#if showText}
							<text
								x={4}
								y={ROW_HEIGHT / 2}
								dy="0.35em"
								class="text-[11px] font-mono fill-gray-800 dark:fill-gray-100 pointer-events-none select-none"
								style="text-shadow: {isRoot ? 'none' : '0 0 2px rgba(0,0,0,0.3)'}"
							>
								{node.name.length > widthPx / 7
									? node.name.slice(0, Math.floor(widthPx / 7) - 1) + '…'
									: node.name}
							</text>
						{/if}
					</g>
				{/each}
			</svg>
		</div>
	{:else}
		<div class="flex items-center justify-center h-50 text-gray-500 text-sm">
			{#if !data}
				Waiting for stack trace data...
			{:else}
				No stack frames to display
			{/if}
		</div>
	{/if}

	<!-- Tooltip -->
	{#if tooltipNode}
		<div
			class="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full -mt-3 bg-white/[.98] dark:bg-gray-900/[.98] border border-gray-300 dark:border-gray-600 rounded-md px-3.5 py-2.5 text-xs shadow-lg max-w-md"
			style="left: {tooltipPosition.x}px; top: {tooltipPosition.y}px;"
			role="tooltip"
		>
			<div class="font-mono break-all mb-1.5 text-gray-900 dark:text-gray-100 font-medium">
				{tooltipNode.name}
			</div>
			{#if tooltipNode.source}
				<div class="text-blue-600 dark:text-blue-400 text-[10px] mb-1">
					{tooltipNode.source.fieldName}
					{#if tooltipNode.source.description}
						<span class="text-gray-400 dark:text-gray-500">
							- {tooltipNode.source.description}</span
						>
					{/if}
				</div>
			{/if}
			<div class="text-gray-500 dark:text-gray-400 text-[11px]">
				{tooltipNode.value.toLocaleString()} samples ({getPercentage(
					tooltipNode.value,
					totalValue
				).toFixed(2)}%)
			</div>
			{#if tooltipDepth !== 0 && tooltipNode.name !== 'all'}
				<div class="text-gray-400 dark:text-gray-500 text-[10px] mt-1 italic">Click to zoom</div>
			{/if}
		</div>
	{/if}
</div>
