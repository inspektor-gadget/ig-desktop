<script lang="ts">
	import NetworkMapChart from './NetworkMapChart.svelte';
	import {
		extractNetworkMapConfig,
		processEvents,
		updateActivityStates,
		graphStateToArrays,
		createEmptyGraphState
	} from '$lib/utils/networkMapConfig';
	import type { VisualizerPluginProps } from '$lib/types/plugin-api';
	import type { NetworkGraphState, NetworkNode, NetworkMapOptions } from '$lib/types/networkmap';
	import { EDGE_ANIMATION_DURATION, DEFAULT_EPHEMERAL_PORT_THRESHOLD } from '$lib/types/networkmap';

	type Props = VisualizerPluginProps;

	let {
		ds,
		events,
		snapshotData,
		eventVersion = 0,
		isRunning = true,
		instanceID = '',
		context
	}: Props = $props();

	// Extract network map config from datasource
	const networkMapConfig = $derived(extractNetworkMapConfig(ds));

	// Processing options - collapse ephemeral ports by default
	let collapseEphemeral = $state(true);
	const options = $derived<NetworkMapOptions>({
		ephemeralPortThreshold: collapseEphemeral ? DEFAULT_EPHEMERAL_PORT_THRESHOLD : 0
	});

	// Track last processed version and options to detect changes
	let lastProcessedVersion = $state(-1);
	let lastOptionsHash = $state('');

	// Graph state for incremental updates
	let graphState = $state<NetworkGraphState>(createEmptyGraphState());

	// Reset graph when options change
	$effect(() => {
		const optionsHash = JSON.stringify(options);
		if (optionsHash !== lastOptionsHash) {
			graphState = createEmptyGraphState();
			lastProcessedVersion = -1;
			lastOptionsHash = optionsHash;
		}
	});

	// Activity update interval
	let activityInterval: ReturnType<typeof setInterval> | undefined;

	// Update graph when new events arrive
	$effect(() => {
		if (!networkMapConfig.isValidNetworkMap || !networkMapConfig.fields) return;

		// Skip if we've already processed this version
		if (eventVersion === lastProcessedVersion) return;

		// Get current events
		const eventsArray = snapshotData ?? events?.toArray() ?? [];

		if (eventsArray.length > 0) {
			// Process all events - the graph state handles deduplication
			// This ensures we catch events even when ring buffer wraps
			const now = Date.now();
			graphState = processEvents(graphState, eventsArray, networkMapConfig.fields, now, options);
		}

		lastProcessedVersion = eventVersion;
	});

	// Periodic activity state updates
	$effect(() => {
		// Clear any existing interval
		if (activityInterval) {
			clearInterval(activityInterval);
		}

		// Set up interval for activity updates
		activityInterval = setInterval(() => {
			graphState = updateActivityStates(graphState, Date.now());
		}, EDGE_ANIMATION_DURATION);

		// Cleanup on unmount
		return () => {
			if (activityInterval) {
				clearInterval(activityInterval);
			}
		};
	});

	// Convert graph state to arrays for the chart
	const { nodes, edges } = $derived(graphStateToArrays(graphState));

	// Handle node position updates from the chart (after layout)
	function handleNodesChange(updatedNodes: NetworkNode[]) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Intentional: cloning Map for immutable state update
		const nodesMap = new Map(graphState.nodesMap);
		for (const node of updatedNodes) {
			const existing = nodesMap.get(node.id);
			if (existing) {
				nodesMap.set(node.id, {
					...existing,
					position: node.position
				});
			}
		}
		graphState = {
			...graphState,
			nodesMap
		};
	}
</script>

<div class="h-full w-full relative">
	{#if networkMapConfig.isValidNetworkMap}
		<!-- Options overlay -->
		<div
			class="absolute top-2 right-2 z-20 flex items-center gap-2 bg-white/90 dark:bg-gray-800/90 rounded px-2 py-1 text-xs"
		>
			<label class="flex items-center gap-1.5 cursor-pointer text-gray-600 dark:text-gray-300">
				<input
					type="checkbox"
					bind:checked={collapseEphemeral}
					class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
				/>
				<span>Collapse high ports</span>
			</label>
		</div>

		{#if nodes.length > 0}
			<NetworkMapChart {nodes} {edges} onNodesChange={handleNodesChange} />
		{:else}
			<div class="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
				<div class="text-center">
					<p class="text-lg">Waiting for network data...</p>
					<p class="text-sm mt-2">Connections will appear as events arrive</p>
				</div>
			</div>
		{/if}
	{:else}
		<div class="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
			<div class="text-center">
				<p class="text-lg">Network map not available</p>
				<p class="text-sm mt-2">This datasource doesn't have the required src/dst address fields</p>
			</div>
		</div>
	{/if}
</div>
