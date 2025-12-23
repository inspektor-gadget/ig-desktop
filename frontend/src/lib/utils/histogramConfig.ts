/**
 * Histogram configuration utilities for extracting config from datasource annotations
 * and processing histogram data.
 *
 * This handles eBPF histogram data format where:
 * - Field value is a comma-separated list of bucket counts
 * - metrics.type=histogram annotation or type:gadget_histogram_slot__u32 tag identifies histogram fields
 * - metrics.unit contains the unit for values
 * - metrics.buckets contains optional comma-separated bucket boundaries
 */

import type { Datasource, DatasourceField } from '$lib/types/charts';
import type {
	HistogramConfig,
	HistogramFieldConfig,
	ParsedHistogramData,
	AggregatedHistogram,
	HeatmapData,
	HeatmapCell,
	HistogramSnapshot
} from '$lib/types/histogram';
import type { GroupableField } from '$lib/types/flamegraph';

// Re-export groupable field utilities (same as flamegraph)
export { extractGroupableFields, DEFAULT_GROUP_FIELDS } from './flamegraphConfig';

/** Default bucket boundaries: powers of 2 */
const DEFAULT_BUCKETS = [
	1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536
];

/**
 * Check if a field is a histogram field.
 * Detection criteria:
 * 1. field.annotations?.['metrics.type'] === 'histogram'
 * 2. field.tags?.includes('type:gadget_histogram_slot__u32')
 */
function isHistogramField(field: DatasourceField): boolean {
	// Check annotation
	if (field.annotations?.['metrics.type'] === 'histogram') {
		return true;
	}
	// Check tags
	if (field.tags?.includes('type:gadget_histogram_slot__u32')) {
		return true;
	}
	return false;
}

/**
 * Parse bucket boundaries from annotation or use defaults.
 * Buckets annotation format: "1,2,4,8,16,32" (comma-separated)
 */
function parseBuckets(annotation?: string): number[] {
	if (!annotation) {
		return DEFAULT_BUCKETS;
	}
	const parsed = annotation
		.split(',')
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => !isNaN(n));
	return parsed.length > 0 ? parsed : DEFAULT_BUCKETS;
}

/**
 * Extract histogram configuration from datasource annotations.
 * Looks for fields with histogram markers.
 *
 * @param ds - Datasource with fields and annotations
 * @returns HistogramConfig with histogram fields
 */
export function extractHistogramConfig(ds: Datasource): HistogramConfig {
	const histogramFields: HistogramFieldConfig[] = [];

	for (const field of ds.fields) {
		if (isHistogramField(field)) {
			histogramFields.push({
				fieldName: field.name,
				fullName: field.fullName,
				unit: field.annotations?.['metrics.unit'],
				buckets: parseBuckets(field.annotations?.['metrics.buckets']),
				label: field.annotations?.['description'] || field.name
			});
		}
	}

	return {
		histogramFields,
		isValidHistogram: histogramFields.length > 0
	};
}

/**
 * Parse histogram value to numeric array.
 * Supports both:
 * - Array values: [0, 5, 12, 3, 1, 0]
 * - String values: "0,5,12,3,1,0" (comma-separated bucket counts)
 *
 * @param value - Array or comma-separated string of bucket values
 * @param buckets - Bucket boundaries for reference
 * @returns ParsedHistogramData
 */
export function parseHistogramValue(value: unknown, buckets: number[]): ParsedHistogramData {
	let values: number[];

	if (Array.isArray(value)) {
		// Already an array - convert to numbers
		values = value.map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10) || 0));
	} else if (typeof value === 'string' && value) {
		// Comma-separated string
		values = value.split(',').map((s) => parseInt(s.trim(), 10) || 0);
	} else {
		// Invalid or empty - return zeros
		return { buckets, values: buckets.map(() => 0), total: 0 };
	}

	// Use the values as-is (they define the bucket count)
	// If buckets annotation wasn't provided, generate default buckets to match value length
	const effectiveBuckets =
		buckets.length === values.length ? buckets : values.map((_, i) => Math.pow(2, i)); // Powers of 2 for each bucket

	const total = values.reduce((sum, v) => sum + v, 0);

	return { buckets: effectiveBuckets, values, total };
}

/**
 * Aggregate histograms from multiple events by group key.
 *
 * @param events - Array of event records
 * @param histogramField - Histogram field configuration
 * @param groupFields - Fields to group by
 * @returns Map of group key to aggregated histogram
 */
export function aggregateHistogramsByGroup(
	events: Record<string, unknown>[],
	histogramField: HistogramFieldConfig,
	groupFields: GroupableField[]
): Map<string, AggregatedHistogram> {
	const aggregated = new Map<string, AggregatedHistogram>();

	for (const event of events) {
		// Build group key from field values
		const groupKey =
			groupFields.length > 0
				? groupFields.map((g) => String(event[g.fieldName] ?? 'unknown')).join(' / ')
				: 'all';

		const value = event[histogramField.fullName];
		const parsed = parseHistogramValue(value, histogramField.buckets);

		if (!aggregated.has(groupKey)) {
			aggregated.set(groupKey, {
				groupKey,
				buckets: parsed.buckets,
				values: [...parsed.values],
				total: parsed.total
			});
		} else {
			const existing = aggregated.get(groupKey)!;
			// Handle case where bucket counts might differ (extend if needed)
			while (existing.values.length < parsed.values.length) {
				existing.values.push(0);
				existing.buckets.push(Math.pow(2, existing.buckets.length));
			}
			existing.values = existing.values.map((v, i) => v + (parsed.values[i] || 0));
			existing.total += parsed.total;
		}
	}

	return aggregated;
}

/**
 * Build heatmap data from multiple snapshots.
 *
 * @param snapshots - Array of snapshot data
 * @param histogramField - Histogram field configuration
 * @param groupFields - Fields to group by
 * @param selectedGroupKey - Optional group key to filter by
 * @returns HeatmapData for rendering
 */
export function buildHeatmapData(
	snapshots: HistogramSnapshot[],
	histogramField: HistogramFieldConfig,
	groupFields: GroupableField[],
	selectedGroupKey?: string
): HeatmapData {
	const cells: HeatmapCell[] = [];
	const timeLabels: Date[] = [];
	let maxValue = 0;
	let detectedBuckets: number[] | null = null;

	// Process snapshots in chronological order (oldest first for display)
	const orderedSnapshots = [...snapshots].reverse();

	for (let timeIndex = 0; timeIndex < orderedSnapshots.length; timeIndex++) {
		const snapshot = orderedSnapshots[timeIndex];
		timeLabels.push(new Date(snapshot.receivedAt));

		// Aggregate by group for this snapshot
		const aggregated = aggregateHistogramsByGroup(snapshot.data, histogramField, groupFields);

		// Detect bucket count from first aggregated result
		if (!detectedBuckets && aggregated.size > 0) {
			const firstAgg = aggregated.values().next().value;
			if (firstAgg) {
				detectedBuckets = firstAgg.buckets;
			}
		}

		const bucketCount = detectedBuckets?.length || histogramField.buckets.length;

		// If filtering by group, use that; otherwise sum all groups
		let valuesForTime: number[];
		if (selectedGroupKey && aggregated.has(selectedGroupKey)) {
			valuesForTime = aggregated.get(selectedGroupKey)!.values;
		} else {
			// Sum all groups
			valuesForTime = new Array(bucketCount).fill(0);
			for (const agg of aggregated.values()) {
				agg.values.forEach((v, i) => {
					if (i < valuesForTime.length) {
						valuesForTime[i] += v;
					}
				});
			}
		}

		// Generate bucket labels dynamically
		const buckets = detectedBuckets || histogramField.buckets;
		const bucketLabels = buckets.map((b, i, arr) => {
			if (i === arr.length - 1) return `>=${formatBucketValue(b)}`;
			return `${formatBucketValue(b)}-${formatBucketValue(arr[i + 1])}`;
		});

		// Create cells for each bucket
		for (let bucketIndex = 0; bucketIndex < valuesForTime.length; bucketIndex++) {
			const value = valuesForTime[bucketIndex];
			maxValue = Math.max(maxValue, value);
			cells.push({
				timeIndex,
				bucketIndex,
				value,
				timestamp: timeLabels[timeIndex],
				bucketLabel: bucketLabels[bucketIndex] || `Bucket ${bucketIndex}`
			});
		}
	}

	// Generate final bucket labels
	const buckets = detectedBuckets || histogramField.buckets;
	const bucketLabels = buckets.map((b, i, arr) => {
		if (i === arr.length - 1) return `>=${formatBucketValue(b)}`;
		return `${formatBucketValue(b)}-${formatBucketValue(arr[i + 1])}`;
	});

	return {
		cells,
		bucketLabels,
		timeLabels,
		maxValue,
		unit: histogramField.unit
	};
}

/**
 * Format bucket value for display (with SI suffixes for large numbers).
 */
function formatBucketValue(value: number): string {
	if (value >= 1000000) {
		return `${(value / 1000000).toFixed(1)}M`;
	}
	if (value >= 1000) {
		return `${(value / 1000).toFixed(1)}k`;
	}
	return String(value);
}

/**
 * Format bucket boundary for display with optional unit.
 */
export function formatBucketLabel(value: number, unit?: string): string {
	const formatted = formatBucketValue(value);
	return unit ? `${formatted}${unit}` : formatted;
}

/**
 * Get unique group keys from aggregated histograms, sorted alphabetically.
 */
export function getGroupKeys(aggregated: Map<string, AggregatedHistogram>): string[] {
	return Array.from(aggregated.keys()).sort();
}
