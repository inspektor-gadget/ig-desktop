<script lang="ts">
	import { getContext } from 'svelte';
	import HistogramBarChart from './HistogramBarChart.svelte';
	import HistogramHeatmap from './HistogramHeatmap.svelte';
	import {
		extractHistogramConfig,
		extractGroupableFields,
		aggregateHistogramsByGroup,
		buildHeatmapData,
		DEFAULT_GROUP_FIELDS
	} from '$lib/utils/histogramConfig';
	import { configuration } from '$lib/stores/configuration.svelte';
	import type { VisualizerPluginProps } from '$lib/types/plugin-api';
	import type { HistogramSnapshot } from '$lib/types/histogram';

	type ViewMode = 'heatmap' | 'barchart';

	interface Props extends VisualizerPluginProps {
		/** Multiple snapshots for heatmap mode */
		multipleSnapshots?: HistogramSnapshot[];
	}

	let {
		ds,
		events,
		snapshotData,
		multipleSnapshots,
		eventVersion = 0,
		isRunning = true,
		instanceID = '',
		context
	}: Props = $props();

	// View mode state - default to heatmap
	let viewMode = $state<ViewMode>('heatmap');

	// Get gadget info from context (plugin context or Svelte context fallback)
	const gadgetContext: any = getContext('gadget');
	const gadgetImage = $derived(context?.gadgetImage || gadgetContext?.info?.imageName || '');

	// Configuration key for group field selection (per gadget + datasource)
	const groupConfigKey = $derived(gadgetImage ? `histogramGroups:${gadgetImage}:${ds.name}` : '');

	// Extract histogram config from annotations
	const histogramConfig = $derived(extractHistogramConfig(ds));

	// Extract groupable fields from datasource (same logic as flamegraph)
	const groupableFields = $derived(extractGroupableFields(ds));

	// Compute default group field selection (pre-select defaults that exist)
	const defaultGroupFields = $derived.by(() => {
		const availableFieldNames = new Set(groupableFields.map((f) => f.fieldName));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Creating new Set for derived value
		const selected = new Set<string>();
		for (const fieldName of DEFAULT_GROUP_FIELDS) {
			if (availableFieldNames.has(fieldName)) {
				selected.add(fieldName);
			}
		}
		return selected;
	});

	// Load saved group fields from configuration, falling back to defaults
	const activeGroupFieldNames = $derived.by(() => {
		if (!groupConfigKey) return defaultGroupFields;

		const stored = configuration.get(groupConfigKey) as string[] | undefined;
		if (!stored) return defaultGroupFields;

		// Filter stored fields to only those that exist in current datasource
		const availableFieldNames = new Set(groupableFields.map((f) => f.fieldName));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Creating new Set for derived value
		const validFields = new Set<string>();
		for (const fieldName of stored) {
			if (availableFieldNames.has(fieldName)) {
				validFields.add(fieldName);
			}
		}
		return validFields;
	});

	// Handler for group field changes
	function handleGroupChange(fields: Set<string>) {
		if (!groupConfigKey) return;
		// Store as array for JSON serialization
		configuration.set(groupConfigKey, Array.from(fields));
	}

	// Get active group fields sorted by level (full objects, not just names)
	const sortedActiveGroupFields = $derived.by(() => {
		if (activeGroupFieldNames.size === 0) return [];
		// Filter to active fields - already sorted by level from extractGroupableFields
		return groupableFields.filter((f) => activeGroupFieldNames.has(f.fieldName));
	});

	// Get events array from snapshot data or ring buffer
	const eventsArray = $derived.by(() => {
		if (snapshotData) return snapshotData;
		// Track eventVersion for reactivity
		void eventVersion;
		return events?.toArray() ?? [];
	});

	// Check if we have multiple snapshots available
	const hasMultipleSnapshots = $derived(multipleSnapshots && multipleSnapshots.length > 1);

	// Determine which view to show based on user choice and data availability
	const showHeatmap = $derived(hasMultipleSnapshots && viewMode === 'heatmap');

	// For bar chart: aggregate histograms by group
	// When multiple snapshots exist, accumulate all data
	const aggregatedHistograms = $derived.by(() => {
		if (!histogramConfig.isValidHistogram) {
			return new Map();
		}

		// If we have multiple snapshots and showing bar chart, accumulate all
		if (hasMultipleSnapshots && viewMode === 'barchart') {
			const allEvents = multipleSnapshots!.flatMap((s) => s.data);
			return aggregateHistogramsByGroup(
				allEvents,
				histogramConfig.histogramFields[0],
				sortedActiveGroupFields
			);
		}

		// Single snapshot or no multiple snapshots
		if (!eventsArray.length) {
			return new Map();
		}
		return aggregateHistogramsByGroup(
			eventsArray,
			histogramConfig.histogramFields[0],
			sortedActiveGroupFields
		);
	});

	// For heatmap: build heatmap data from multiple snapshots
	const heatmapData = $derived.by(() => {
		if (!hasMultipleSnapshots || !histogramConfig.isValidHistogram) {
			return null;
		}
		return buildHeatmapData(
			multipleSnapshots!,
			histogramConfig.histogramFields[0],
			sortedActiveGroupFields
		);
	});

	// Info text for display
	const snapshotCount = $derived(multipleSnapshots?.length ?? 1);
	const bucketCount = $derived(
		heatmapData?.bucketLabels.length ??
			aggregatedHistograms.values().next().value?.buckets.length ??
			0
	);
</script>

<div class="h-full w-full flex flex-col overflow-hidden">
	{#if histogramConfig.isValidHistogram}
		<!-- Header with view mode toggle -->
		{#if hasMultipleSnapshots}
			<div
				class="flex items-center justify-center gap-4 px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex-shrink-0"
			>
				<!-- View mode toggle -->
				<div
					class="flex items-center rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden"
				>
					<button
						class="px-3 py-1 text-[11px] font-medium transition-colors {viewMode === 'heatmap'
							? 'bg-blue-500 text-white'
							: 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'}"
						onclick={() => (viewMode = 'heatmap')}
					>
						Heatmap
					</button>
					<button
						class="px-3 py-1 text-[11px] font-medium transition-colors border-l border-gray-300 dark:border-gray-600 {viewMode ===
						'barchart'
							? 'bg-blue-500 text-white'
							: 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'}"
						onclick={() => (viewMode = 'barchart')}
					>
						Bar Chart
					</button>
				</div>

				<!-- Info -->
				<span class="text-[11px] text-gray-500 dark:text-gray-400">
					{snapshotCount} snapshots &times; {bucketCount} buckets
				</span>
			</div>
		{/if}

		<!-- Chart content -->
		<div class="flex-1 min-h-0">
			{#if showHeatmap && heatmapData}
				<HistogramHeatmap
					data={heatmapData}
					{groupableFields}
					activeGroupFields={activeGroupFieldNames}
					onGroupChange={handleGroupChange}
				/>
			{:else}
				<HistogramBarChart
					histograms={aggregatedHistograms}
					config={histogramConfig.histogramFields[0]}
					{groupableFields}
					activeGroupFields={activeGroupFieldNames}
					onGroupChange={handleGroupChange}
				/>
			{/if}
		</div>
	{:else}
		<div class="flex items-center justify-center h-full text-gray-500 dark:text-gray-400 text-sm">
			No histogram configuration found
		</div>
	{/if}
</div>
