/**
 * Histogram type definitions
 *
 * These types support histogram rendering from eBPF gadget histogram data.
 * Histogram data is detected via metrics.type=histogram annotation or
 * type:gadget_histogram_slot__u32 tag.
 */

/**
 * Histogram field configuration extracted from datasource annotations.
 */
export interface HistogramFieldConfig {
	/** Field name (short) */
	fieldName: string;
	/** Full field name including parent path */
	fullName: string;
	/** Unit for display (from metrics.unit annotation) */
	unit?: string;
	/** Bucket boundaries (from metrics.buckets or default powers of 2) */
	buckets: number[];
	/** Label for display */
	label: string;
}

/**
 * Histogram configuration extracted from datasource.
 */
export interface HistogramConfig {
	/** Detected histogram fields */
	histogramFields: HistogramFieldConfig[];
	/** Whether this datasource has valid histogram configuration */
	isValidHistogram: boolean;
}

/**
 * Parsed histogram data for a single event/row.
 */
export interface ParsedHistogramData {
	/** Bucket boundaries */
	buckets: number[];
	/** Values for each bucket */
	values: number[];
	/** Total count across all buckets */
	total: number;
}

/**
 * Aggregated histogram for multiple events (grouped by key).
 */
export interface AggregatedHistogram {
	/** Group key value (e.g., "nginx", "default/pod-1") */
	groupKey: string;
	/** Bucket boundaries */
	buckets: number[];
	/** Aggregated values for each bucket */
	values: number[];
	/** Total count */
	total: number;
}

/**
 * Heatmap cell data for time-series histogram visualization.
 */
export interface HeatmapCell {
	/** Snapshot/time index (X axis) */
	timeIndex: number;
	/** Bucket index (Y axis) */
	bucketIndex: number;
	/** Count value (determines color intensity) */
	value: number;
	/** Timestamp of this snapshot */
	timestamp: Date;
	/** Bucket boundary label */
	bucketLabel: string;
}

/**
 * Heatmap data structure for rendering.
 */
export interface HeatmapData {
	/** Array of cells to render */
	cells: HeatmapCell[];
	/** Bucket labels (Y axis) */
	bucketLabels: string[];
	/** Time labels (X axis) */
	timeLabels: Date[];
	/** Maximum value for color scaling */
	maxValue: number;
	/** Unit for display */
	unit?: string;
}

/**
 * Snapshot data for heatmap building.
 */
export interface HistogramSnapshot {
	/** Snapshot data array */
	data: Record<string, unknown>[];
	/** Timestamp when received */
	receivedAt: number;
	/** Batch identifier */
	batchId: number;
}
