<script lang="ts">
	import * as d3 from 'd3';
	import { clickOutside } from '$lib/utils/click-outside';
	import ChevronDown from '$lib/icons/chevron-down.svg?raw';
	import type { HeatmapData, HeatmapCell } from '$lib/types/histogram';
	import type { GroupableField } from '$lib/types/flamegraph';

	interface Props {
		data: HeatmapData;
		groupableFields?: GroupableField[];
		activeGroupFields?: Set<string>;
		onGroupChange?: (fields: Set<string>) => void;
	}

	let {
		data,
		groupableFields = [],
		activeGroupFields = new Set(),
		onGroupChange
	}: Props = $props();

	// Container dimensions - observe the scroll container to account for scrollbar
	let containerWidth = $state(600);
	let scrollContainerRef: HTMLDivElement | undefined = $state();

	// ResizeObserver with requestAnimationFrame to prevent loop errors
	$effect(() => {
		if (!scrollContainerRef) return;

		// Use clientWidth to exclude scrollbar, subtract padding (p-2 = 16px total)
		containerWidth = (scrollContainerRef.clientWidth || 600) - 16;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				requestAnimationFrame(() => {
					containerWidth = ((entry.target as HTMLElement).clientWidth || 600) - 16;
				});
			}
		});

		resizeObserver.observe(scrollContainerRef);

		return () => {
			resizeObserver.disconnect();
		};
	});

	// Group dropdown state
	let groupMenuOpen = $state(false);

	// Tooltip state
	let tooltipData = $state<{ x: number; y: number; cell: HeatmapCell } | null>(null);

	const height = 400;
	const margins = {
		top: 20,
		right: 80, // Space for color legend
		bottom: 80, // Space for rotated time labels
		left: 100 // Space for bucket labels
	};

	const boundedWidth = $derived(Math.max(containerWidth - margins.left - margins.right, 0));
	const boundedHeight = $derived(height - margins.top - margins.bottom);

	// Cell dimensions
	const cellWidth = $derived(
		data.timeLabels.length > 0 ? Math.max(2, boundedWidth / data.timeLabels.length) : 20
	);
	const cellHeight = $derived(
		data.bucketLabels.length > 0 ? Math.max(10, boundedHeight / data.bucketLabels.length) : 20
	);

	// Check if dark mode is active
	let isDarkMode = $state(false);

	$effect(() => {
		// Check for dark mode class on document
		const checkDarkMode = () => {
			isDarkMode = document.documentElement.classList.contains('dark');
		};
		checkDarkMode();

		// Watch for changes
		const observer = new MutationObserver(checkDarkMode);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		return () => observer.disconnect();
	});

	// Color scale (warm colors: yellow -> orange -> red)
	const colorScale = $derived.by(() => {
		return d3.scaleSequential(d3.interpolateYlOrRd).domain([0, data.maxValue || 1]);
	});

	// Get cell color - transparent/dark for zero values
	function getCellColor(value: number): string {
		if (value === 0) {
			return isDarkMode ? 'rgba(55, 65, 81, 0.3)' : 'rgba(243, 244, 246, 0.5)'; // gray-700/gray-100 with alpha
		}
		return colorScale(value);
	}

	// Time format
	const formatTime = d3.timeFormat('%H:%M:%S');

	// Toggle group field
	function toggleGroupField(fieldName: string) {
		const newFields = new Set(activeGroupFields);
		if (newFields.has(fieldName)) {
			newFields.delete(fieldName);
		} else {
			newFields.add(fieldName);
		}
		onGroupChange?.(newFields);
	}

	// Active group count
	const activeGroupCount = $derived(activeGroupFields.size);

	// Compute which time labels to show (every Nth to avoid crowding)
	const timeTickIndices = $derived.by(() => {
		if (data.timeLabels.length <= 10) {
			return data.timeLabels.map((_, i) => i);
		}
		const step = Math.ceil(data.timeLabels.length / 10);
		const indices: number[] = [];
		for (let i = 0; i < data.timeLabels.length; i += step) {
			indices.push(i);
		}
		// Always include the last one
		if (indices[indices.length - 1] !== data.timeLabels.length - 1) {
			indices.push(data.timeLabels.length - 1);
		}
		return indices;
	});

	// Legend gradient steps
	const legendSteps = 5;
	const legendHeight = $derived(Math.min(boundedHeight, 150));

	function handleCellMouseEnter(e: MouseEvent, cell: HeatmapCell) {
		tooltipData = { x: e.clientX, y: e.clientY, cell };
	}

	function handleCellMouseMove(e: MouseEvent) {
		if (tooltipData) {
			tooltipData = { ...tooltipData, x: e.clientX, y: e.clientY };
		}
	}

	function handleCellMouseLeave() {
		tooltipData = null;
	}
</script>

<div class="flex h-full w-full flex-col overflow-hidden">
	<!-- Controls bar -->
	<div
		class="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex-shrink-0"
	>
		<!-- Group by dropdown -->
		{#if groupableFields.length > 0}
			<div
				class="relative"
				use:clickOutside={{ enabled: groupMenuOpen, onClickOutside: () => (groupMenuOpen = false) }}
			>
				<button
					class="flex items-center gap-1 py-1 px-2 border rounded text-[11px] cursor-pointer transition-all hover:border-gray-400 {activeGroupCount >
					0
						? 'bg-blue-100 dark:bg-blue-900 border-blue-500 text-blue-700 dark:text-blue-300'
						: 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'}"
					onclick={() => (groupMenuOpen = !groupMenuOpen)}
					aria-haspopup="menu"
					aria-expanded={groupMenuOpen}
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
						role="menu"
						class="absolute top-full left-0 mt-1 min-w-52 max-h-70 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg z-50"
					>
						<div
							class="px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700"
						>
							Group by:
						</div>
						<div class="py-1">
							{#each groupableFields as field (field.fieldName)}
								<label
									class="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
									title={field.description || field.fieldName}
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
	</div>

	<!-- Heatmap area -->
	{#if data.cells.length > 0}
		<div bind:this={scrollContainerRef} class="flex-1 min-h-0 p-2 overflow-auto">
			<svg width={containerWidth} {height} class="block">
				<g transform="translate({margins.left}, {margins.top})">
					<!-- Heatmap cells -->
					{#each data.cells as cell (cell.timeIndex + '-' + cell.bucketIndex)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<rect
							class="cursor-pointer transition-opacity hover:opacity-80"
							x={cell.timeIndex * cellWidth}
							y={(data.bucketLabels.length - 1 - cell.bucketIndex) * cellHeight}
							width={Math.max(cellWidth - 1, 1)}
							height={Math.max(cellHeight - 1, 1)}
							fill={getCellColor(cell.value)}
							onmouseenter={(e) => handleCellMouseEnter(e, cell)}
							onmousemove={handleCellMouseMove}
							onmouseleave={handleCellMouseLeave}
						/>
					{/each}

					<!-- Y-axis (bucket labels) -->
					<g class="text-[10px] fill-gray-500 dark:fill-gray-400">
						{#each data.bucketLabels as label, i}
							<text
								x={-8}
								y={(data.bucketLabels.length - 1 - i) * cellHeight + cellHeight / 2}
								text-anchor="end"
								dominant-baseline="middle"
							>
								{label}
							</text>
						{/each}
						<text
							x={-margins.left + 12}
							y={boundedHeight / 2}
							text-anchor="middle"
							dominant-baseline="middle"
							transform="rotate(-90, {-margins.left + 12}, {boundedHeight / 2})"
							class="text-[11px] font-medium"
						>
							Bucket {data.unit ? `(${data.unit})` : ''}
						</text>
					</g>

					<!-- X-axis (time labels) -->
					<g
						transform="translate(0, {data.bucketLabels.length * cellHeight})"
						class="text-[10px] fill-gray-500 dark:fill-gray-400"
					>
						{#each timeTickIndices as i}
							{@const x = i * cellWidth + cellWidth / 2}
							{@const time = data.timeLabels[i]}
							<text
								{x}
								y={12}
								text-anchor="end"
								dominant-baseline="hanging"
								transform="rotate(-45, {x}, 12)"
							>
								{formatTime(time)}
							</text>
						{/each}
						<text
							x={boundedWidth / 2}
							y={margins.bottom - 12}
							text-anchor="middle"
							class="text-[11px] font-medium"
						>
							Time (oldest → newest)
						</text>
					</g>
				</g>

				<!-- Color legend -->
				<g transform="translate({containerWidth - margins.right + 20}, {margins.top})">
					<defs>
						<linearGradient id="heatmap-gradient" x1="0" x2="0" y1="1" y2="0">
							{#each Array(legendSteps + 1) as _, i}
								{@const t = i / legendSteps}
								<stop
									offset="{t * 100}%"
									stop-color={t === 0
										? isDarkMode
											? 'rgba(55, 65, 81, 0.3)'
											: 'rgba(243, 244, 246, 0.5)'
										: colorScale(t * data.maxValue)}
								/>
							{/each}
						</linearGradient>
					</defs>
					<rect
						width="16"
						height={legendHeight}
						fill="url(#heatmap-gradient)"
						rx="2"
						class="stroke-gray-300 dark:stroke-gray-600"
					/>
					<text
						x="20"
						y="0"
						class="text-[10px] fill-gray-500 dark:fill-gray-400"
						dominant-baseline="hanging"
					>
						{data.maxValue.toLocaleString()}
					</text>
					<text
						x="20"
						y={legendHeight}
						class="text-[10px] fill-gray-500 dark:fill-gray-400"
						dominant-baseline="auto"
					>
						0
					</text>
					<text
						x="8"
						y={legendHeight + 20}
						text-anchor="middle"
						class="text-[10px] fill-gray-500 dark:fill-gray-400"
					>
						Count
					</text>
				</g>
			</svg>
		</div>
	{:else}
		<div class="flex items-center justify-center h-50 text-gray-500 dark:text-gray-400 text-sm">
			No data in snapshots.
		</div>
	{/if}

	<!-- Tooltip -->
	{#if tooltipData}
		<div
			class="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full -mt-3 bg-white/[.98] dark:bg-gray-900/[.98] border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-xs shadow-lg"
			style="left: {tooltipData.x}px; top: {tooltipData.y}px;"
		>
			<div class="font-medium text-gray-900 dark:text-gray-100 mb-1">
				{formatTime(tooltipData.cell.timestamp)}
			</div>
			<div class="text-gray-600 dark:text-gray-300">
				Bucket: {tooltipData.cell.bucketLabel}
			</div>
			<div class="text-gray-500 dark:text-gray-400">
				Count: {tooltipData.cell.value.toLocaleString()}
			</div>
		</div>
	{/if}
</div>
