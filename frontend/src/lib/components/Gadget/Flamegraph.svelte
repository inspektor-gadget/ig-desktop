<script lang="ts">
	import { getContext } from 'svelte';
	import FlamegraphChart from '../charts/FlamegraphChart.svelte';
	import {
		extractFlamegraphConfig,
		buildFlameHierarchy,
		extractGroupableFields,
		buildFlameHierarchyWithGroups,
		DEFAULT_GROUP_FIELDS
	} from '$lib/utils/flamegraphConfig';
	import { configuration } from '$lib/stores/configuration.svelte';
	import type { Datasource } from '$lib/types/charts';
	import type { EventRingBuffer } from '$lib/utils/ring-buffer';

	interface Props {
		ds: Datasource;
		events?: EventRingBuffer<Record<string, unknown>>;
		/** Snapshot data array (when using snapshots instead of streaming events) */
		snapshotData?: Record<string, unknown>[];
		/** Version counter to trigger re-reads of the ring buffer */
		eventVersion?: number;
	}

	let { ds, events, snapshotData, eventVersion = 0 }: Props = $props();

	// Get gadget info from context for config key
	const gadgetContext: any = getContext('gadget');
	const gadgetImage = $derived(gadgetContext?.info?.imageName || '');

	// Configuration key for group field selection (per gadget + datasource)
	const groupConfigKey = $derived(
		gadgetImage ? `flamegraphGroups:${gadgetImage}:${ds.name}` : ''
	);

	// Extract flamegraph config from annotations
	const flamegraphConfig = $derived(extractFlamegraphConfig(ds));

	// Extract groupable fields from datasource
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

	// Handler for group field changes from FlamegraphChart
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

	// Get events array from either snapshot data or ring buffer
	// eventVersion dependency triggers re-read when new events arrive
	const eventsArray = $derived.by(() => {
		// Prefer snapshot data when available
		if (snapshotData) {
			return snapshotData;
		}
		// Track eventVersion for reactivity (intentionally read to trigger updates)
		void eventVersion;
		return events?.toArray() ?? [];
	});

	// Build hierarchical flame data structure
	const flameData = $derived.by(() => {
		if (!eventsArray.length || !flamegraphConfig.isValidFlamegraph) {
			return null;
		}

		// Use grouping if there are active group fields
		if (sortedActiveGroupFields.length > 0) {
			return buildFlameHierarchyWithGroups(eventsArray, flamegraphConfig, sortedActiveGroupFields);
		}

		return buildFlameHierarchy(eventsArray, flamegraphConfig);
	});
</script>

<div class="h-full w-full">
	<FlamegraphChart
		data={flameData}
		{groupableFields}
		activeGroupFields={activeGroupFieldNames}
		onGroupChange={handleGroupChange}
	/>
</div>
