<script lang="ts">
	import * as d3 from 'd3';
	import { clickOutside } from '$lib/utils/click-outside';
	import { formatBucketLabel, getGroupKeys } from '$lib/utils/histogramConfig';
	import ChevronDown from '$lib/icons/chevron-down.svg?raw';
	import type { AggregatedHistogram, HistogramFieldConfig } from '$lib/types/histogram';
	import type { GroupableField } from '$lib/types/flamegraph';

	interface Props {
		histograms: Map<string, AggregatedHistogram>;
		config: HistogramFieldConfig;
		groupableFields?: GroupableField[];
		activeGroupFields?: Set<string>;
		onGroupChange?: (fields: Set<string>) => void;
	}

	let {
		histograms,
		config,
		groupableFields = [],
		activeGroupFields = new Set(),
		onGroupChange
	}: Props = $props();

	// Container dimensions - observe the chart container to get accurate width
	let containerWidth = $state(600);
	let chartContainerRef: HTMLDivElement | undefined = $state();

	// ResizeObserver with requestAnimationFrame to prevent loop errors
	$effect(() => {
		if (!chartContainerRef) return;

		// Use clientWidth and subtract padding (p-2 = 16px total)
		containerWidth = (chartContainerRef.clientWidth || 600) - 16;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				requestAnimationFrame(() => {
					containerWidth = ((entry.target as HTMLElement).clientWidth || 600) - 16;
				});
			}
		});

		resizeObserver.observe(chartContainerRef);

		return () => {
			resizeObserver.disconnect();
		};
	});

	// Group dropdown state
	let groupMenuOpen = $state(false);

	// Selected group for visualization (null = show all aggregated)
	let selectedGroup = $state<string | null>(null);

	// Tooltip state
	let tooltipData = $state<{
		x: number;
		y: number;
		label: string;
		value: number;
		percentage: number;
	} | null>(null);

	const height = 300;
	const margins = {
		top: 20,
		right: 20,
		bottom: 60,
		left: 60
	};

	const boundedWidth = $derived(Math.max(containerWidth - margins.left - margins.right, 0));
	const boundedHeight = $derived(height - margins.top - margins.bottom);

	// Get group labels for selector
	const groupLabels = $derived(getGroupKeys(histograms));

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

	// Detect bucket count from data
	const detectedBuckets = $derived.by(() => {
		// Get buckets from first histogram entry, or fall back to config
		const firstHist = histograms.values().next().value;
		return firstHist?.buckets || config.buckets;
	});

	// Get display data (selected group or aggregated all)
	const displayData = $derived.by(() => {
		if (selectedGroup && histograms.has(selectedGroup)) {
			return histograms.get(selectedGroup)!;
		}
		// Aggregate all groups
		const bucketCount = detectedBuckets.length;
		const allValues = new Array(bucketCount).fill(0);
		for (const h of histograms.values()) {
			h.values.forEach((v, i) => {
				if (i < allValues.length) {
					allValues[i] += v;
				}
			});
		}
		return {
			groupKey: 'All',
			buckets: detectedBuckets,
			values: allValues,
			total: allValues.reduce((s, v) => s + v, 0)
		};
	});

	// Generate bucket labels from detected buckets
	const bucketLabels = $derived(
		detectedBuckets.map((b, i, arr) => {
			if (i === arr.length - 1) return `>=${formatBucketLabel(b, config.unit)}`;
			return formatBucketLabel(b, config.unit);
		})
	);

	// X scale (band scale for buckets)
	const xScale = $derived.by(() => {
		return d3.scaleBand<string>().domain(bucketLabels).range([0, boundedWidth]).padding(0.15);
	});

	// Y scale
	const maxValue = $derived(Math.max(...displayData.values, 1));
	const yScale = $derived.by(() => {
		return d3
			.scaleLinear()
			.domain([0, maxValue * 1.1])
			.range([boundedHeight, 0])
			.nice();
	});

	// Y-axis ticks
	const yTicks = $derived(yScale.ticks(5));

	// Format functions
	function formatValue(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
		return String(Math.round(n));
	}

	function handleBarMouseEnter(e: MouseEvent, label: string, value: number, index: number) {
		const percentage = displayData.total > 0 ? (value / displayData.total) * 100 : 0;
		tooltipData = {
			x: e.clientX,
			y: e.clientY,
			label: bucketLabels[index],
			value,
			percentage
		};
	}

	function handleBarMouseMove(e: MouseEvent) {
		if (tooltipData) {
			tooltipData = { ...tooltipData, x: e.clientX, y: e.clientY };
		}
	}

	function handleBarMouseLeave() {
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

		<!-- Group selector -->
		{#if groupLabels.length > 1}
			<select
				class="py-1 px-2 border border-gray-300 dark:border-gray-600 rounded text-[11px] bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 cursor-pointer"
				bind:value={selectedGroup}
			>
				<option value={null}>All groups</option>
				{#each groupLabels as label (label)}
					<option value={label}>{label}</option>
				{/each}
			</select>
		{/if}

		<div class="flex-1"></div>

		<!-- Total count -->
		<span class="text-[11px] text-gray-500 dark:text-gray-400">
			Total: <span class="font-medium text-gray-700 dark:text-gray-300"
				>{displayData.total.toLocaleString()}</span
			>
			{config.unit || 'events'}
		</span>
	</div>

	<!-- Chart area -->
	{#if displayData.values.some((v) => v > 0)}
		<div bind:this={chartContainerRef} class="flex-1 min-h-0 p-2">
			<svg width={containerWidth} {height} class="block text-gray-500 dark:text-gray-400">
				<g transform="translate({margins.left}, {margins.top})">
					<!-- Grid lines -->
					{#each yTicks as tick}
						<line
							x1={0}
							y1={yScale(tick)}
							x2={boundedWidth}
							y2={yScale(tick)}
							class="stroke-gray-200 dark:stroke-gray-700"
						/>
					{/each}

					<!-- Y-axis -->
					<g class="text-[10px] fill-gray-500 dark:fill-gray-400">
						{#each yTicks as tick}
							<text x={-8} y={yScale(tick)} text-anchor="end" dominant-baseline="middle">
								{formatValue(tick)}
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
							Count
						</text>
					</g>

					<!-- X-axis -->
					<g
						transform="translate(0, {boundedHeight})"
						class="text-[10px] fill-gray-500 dark:fill-gray-400"
					>
						<line
							x1={0}
							y1={0}
							x2={boundedWidth}
							y2={0}
							class="stroke-gray-300 dark:stroke-gray-600"
						/>
						{#each bucketLabels as label, i}
							{@const x = (xScale(label) || 0) + xScale.bandwidth() / 2}
							<text
								{x}
								y={12}
								text-anchor="end"
								dominant-baseline="hanging"
								transform="rotate(-45, {x}, 12)"
							>
								{label}
							</text>
						{/each}
						<text
							x={boundedWidth / 2}
							y={margins.bottom - 8}
							text-anchor="middle"
							class="text-[11px] font-medium"
						>
							{config.unit ? `Bucket (${config.unit})` : 'Bucket'}
						</text>
					</g>

					<!-- Bars -->
					{#each displayData.values as value, i}
						{@const label = bucketLabels[i]}
						{@const x = xScale(label) || 0}
						{@const barHeight = boundedHeight - yScale(value)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<rect
							class="cursor-pointer transition-opacity hover:opacity-80 fill-blue-500 dark:fill-blue-400"
							{x}
							y={yScale(value)}
							width={xScale.bandwidth()}
							height={Math.max(0, barHeight)}
							rx="2"
							onmouseenter={(e) => handleBarMouseEnter(e, label, value, i)}
							onmousemove={handleBarMouseMove}
							onmouseleave={handleBarMouseLeave}
						/>
					{/each}
				</g>
			</svg>
		</div>
	{:else}
		<div class="flex items-center justify-center h-50 text-gray-500 dark:text-gray-400 text-sm">
			No data in snapshot.
		</div>
	{/if}

	<!-- Tooltip -->
	{#if tooltipData}
		<div
			class="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full -mt-3 bg-white/[.98] dark:bg-gray-900/[.98] border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-xs shadow-lg"
			style="left: {tooltipData.x}px; top: {tooltipData.y}px;"
		>
			<div class="font-medium text-gray-900 dark:text-gray-100 mb-1">{tooltipData.label}</div>
			<div class="text-gray-500 dark:text-gray-400">
				{tooltipData.value.toLocaleString()} ({tooltipData.percentage.toFixed(1)}%)
			</div>
		</div>
	{/if}
</div>
