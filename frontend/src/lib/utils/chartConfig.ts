/**
 * Chart configuration utilities for extracting series config from datasource annotations
 */

import type {
	DatasourceField,
	ChartSeriesConfig,
	TimestampConfig,
	HistogramConfig,
	CounterMode
} from '$lib/types/charts';

// Grafana-style classic palette for auto-generated series
// Based on Grafana's createVisualizationColors.ts
// This provides 64 distinct colors to minimize collisions
const DEFAULT_COLORS = [
	// Primary colors (bright, high contrast)
	'#73BF69', // green
	'#FADE2A', // semi-dark-yellow
	'#5794F2', // blue
	'#FF9830', // orange
	'#F2495C', // red
	'#B877D9', // purple
	// Dark variants
	'#37872D', // dark-green
	'#E0B400', // dark-yellow
	'#1F60C4', // dark-blue
	'#FA6400', // dark-orange
	'#C4162A', // dark-red
	'#8F3BB8', // dark-purple
	// Super light variants
	'#96D98D', // super-light-green
	'#FFEE52', // super-light-yellow
	'#8AB8FF', // super-light-blue
	'#FFB357', // super-light-orange
	'#FF7383', // super-light-red
	'#CA95E5', // super-light-purple
	// Extended palette (hex values from Grafana classic)
	'#447EBC',
	'#C15C17',
	'#890F02',
	'#0A437C',
	'#6D1F62',
	'#584477',
	'#B7DBAB',
	'#F4D598',
	'#70DBED',
	'#F9BA8F',
	'#F29191',
	'#82B5D8',
	'#E5A8E2',
	'#AEA2E0',
	'#629E51',
	'#E5AC0E',
	'#64B0C8',
	'#E0752D',
	'#BF1B00',
	'#0A50A1',
	'#962D82',
	'#614D93',
	'#9AC48A',
	'#F2C96D',
	'#65C5DB',
	'#F9934E',
	'#EA6460',
	'#5195CE',
	'#D683CE',
	'#806EB7',
	'#3F6833',
	'#967302',
	'#2F575E',
	'#99440A',
	'#58140C',
	'#052B51',
	'#511749',
	'#3F2B5B',
	// Light pastels
	'#E0F9D7',
	'#FCEACA',
	'#CFFAFF',
	'#F9E2D2',
	'#FCE2DE',
	'#BADFF4',
	'#F9D9F9',
	'#DEDAF7'
];

// Metric types that indicate chartable values
const METRIC_TYPES = ['counter', 'gauge', 'histogram'];

// Numeric field kinds that can be charted (case-insensitive matching)
const NUMERIC_KINDS = [
	'uint64',
	'uint32',
	'uint16',
	'uint8',
	'int64',
	'int32',
	'int16',
	'int8',
	'float64',
	'float32',
	'number',
	'int',
	'uint',
	'float',
	'double'
];

/**
 * Extract metric field configuration from datasource.
 * Returns the key fields and metric fields based on metrics.type annotations.
 */
export function extractMetricFields(ds: {
	fields: DatasourceField[];
	annotations?: Record<string, string>;
}): {
	keyFields: DatasourceField[];
	metricFields: DatasourceField[];
} {
	const keyFields: DatasourceField[] = [];
	const metricFields: DatasourceField[] = [];

	for (const field of ds.fields) {
		const metricsType = field.annotations?.['metrics.type'];
		if (metricsType === 'key') {
			keyFields.push(field);
		} else if (metricsType && METRIC_TYPES.includes(metricsType)) {
			metricFields.push(field);
		}
	}

	return { keyFields, metricFields };
}

/**
 * Get the chart type based on metrics.type annotation
 */
function getChartTypeFromMetricType(
	metricsType: string,
	fieldAnnotations?: Record<string, string>
): ChartSeriesConfig['type'] {
	// First check for explicit chart.type annotation
	if (fieldAnnotations?.['chart.type']) {
		return fieldAnnotations['chart.type'] as ChartSeriesConfig['type'];
	}

	// Default based on metric type
	switch (metricsType) {
		case 'counter':
			return 'area';
		case 'gauge':
			return 'line';
		case 'histogram':
			return 'bar';
		default:
			return 'line';
	}
}

/**
 * Get line interpolation from annotation
 * Supports: 'linear' (straight lines, default), 'smooth' (curved)
 */
function getInterpolation(fieldAnnotations?: Record<string, string>): 'linear' | 'smooth' {
	const value = fieldAnnotations?.['chart.interpolation'];
	if (value === 'smooth' || value === 'curve' || value === 'curved') {
		return 'smooth';
	}
	return 'linear'; // Default to straight lines
}

/**
 * Get whether to show dots from annotation
 * Default is true (show dots)
 */
function getShowDots(fieldAnnotations?: Record<string, string>): boolean {
	const value = fieldAnnotations?.['chart.dots'];
	// Default to true, only disable if explicitly set to false/no/0
	if (value === 'false' || value === '0' || value === 'no') {
		return false;
	}
	return true;
}

/**
 * Color registry for stable, ordered color assignment.
 * Colors are assigned in palette order as keys are first seen,
 * and the same key always gets the same color.
 */
const colorRegistry = new Map<string, string>();
let nextColorIndex = 0;

/**
 * Get a stable color for a key value.
 * Colors are assigned in order from the palette as new keys appear.
 * Once a key has a color, it keeps that color forever.
 */
export function getStableColor(keyValue: string): string {
	if (colorRegistry.has(keyValue)) {
		return colorRegistry.get(keyValue)!;
	}

	// Assign the next color in the palette
	const color = DEFAULT_COLORS[nextColorIndex % DEFAULT_COLORS.length];
	colorRegistry.set(keyValue, color);
	nextColorIndex++;

	return color;
}

/**
 * Reset the color registry (useful for testing or when starting fresh)
 */
export function resetColorRegistry(): void {
	colorRegistry.clear();
	nextColorIndex = 0;
}

/**
 * Extract chart series configuration from datasource annotations.
 *
 * Uses metrics.type field annotations:
 * - metrics.type: "key" - grouping key field (e.g., signal name, pod name)
 * - metrics.type: "counter" | "gauge" | "histogram" - metric value to chart
 *
 * For each unique combination of key values, a separate series is created.
 */
export function extractSeriesFromDatasource(ds: {
	fields: DatasourceField[];
	annotations?: Record<string, string>;
}): ChartSeriesConfig[] {
	const { metricFields } = extractMetricFields(ds);

	// If we have metric fields defined via annotations, use them
	if (metricFields.length > 0) {
		// Return base config for metric fields
		// The actual series will be created dynamically based on unique key values
		return metricFields.map((field, i) => ({
			field: field.fullName,
			label: field.annotations?.['description'] || field.name,
			type: getChartTypeFromMetricType(
				field.annotations?.['metrics.type'] || 'gauge',
				field.annotations
			),
			color: field.annotations?.['chart.color'] || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
			fillOpacity: 0.2,
			interpolation: getInterpolation(field.annotations),
			showDots: getShowDots(field.annotations)
		}));
	}

	// Fallback: auto-detect numeric fields
	const annotations = ds.annotations || {};

	// If explicit series list provided via annotation
	if (annotations['chart.series']) {
		const fieldNames = annotations['chart.series'].split(',').map((s) => s.trim());
		return fieldNames
			.map((name, i) => {
				const field = ds.fields.find((f) => f.fullName === name || f.name === name);
				if (!field) return null;

				return {
					field: field.fullName,
					label: field.annotations?.['description'] || field.name,
					type: (field.annotations?.['chart.type'] ||
						annotations['chart.type'] ||
						'line') as ChartSeriesConfig['type'],
					color: field.annotations?.['chart.color'] || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
					fillOpacity: 0.2,
					interpolation: getInterpolation(field.annotations),
					showDots: getShowDots(field.annotations)
				};
			})
			.filter(Boolean) as ChartSeriesConfig[];
	}

	// Auto-detect numeric fields (excluding timestamp and hidden fields)
	const timestampField = findTimestampField(ds.fields);
	const numericFields = ds.fields.filter((f) => {
		// Must be numeric (case-insensitive)
		if (!NUMERIC_KINDS.includes(f.kind?.toLowerCase())) return false;
		// Don't chart the timestamp field
		if (timestampField && f.fullName === timestampField) return false;
		// Respect chart.exclude annotation
		if (f.annotations?.['chart.exclude'] === 'true') return false;
		// Skip hidden fields (flag 0x04)
		if ((f.flags & 0x04) !== 0) return false;
		// Skip empty fields (flag 0x01)
		if ((f.flags & 0x01) !== 0) return false;
		return true;
	});

	// Limit to 4 series max for readability
	return numericFields.slice(0, 4).map((field, i) => ({
		field: field.fullName,
		label: field.annotations?.['description'] || field.name,
		type: (field.annotations?.['chart.type'] || 'line') as ChartSeriesConfig['type'],
		color: field.annotations?.['chart.color'] || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
		fillOpacity: 0.2,
		interpolation: getInterpolation(field.annotations),
		showDots: getShowDots(field.annotations)
	}));
}

/**
 * Group events by unique key combinations and create series for each.
 *
 * @param events - Array of event data
 * @param keyFields - Fields that define the grouping keys
 * @param metricFields - Fields containing the metric values
 * @returns Object with grouped data and dynamic series configs
 */
export function groupEventsByKeys(
	events: Record<string, unknown>[],
	keyFields: DatasourceField[],
	metricFields: DatasourceField[]
): {
	groupedData: Map<string, Record<string, unknown>[]>;
	seriesConfigs: ChartSeriesConfig[];
} {
	const groupedData = new Map<string, Record<string, unknown>[]>();
	const keyFieldNames = keyFields.map((f) => f.fullName);

	// Group events by unique key combination
	for (const event of events) {
		const keyValues = keyFieldNames.map((k) => String(event[k] ?? '')).join('|');

		if (!groupedData.has(keyValues)) {
			groupedData.set(keyValues, []);
		}
		groupedData.get(keyValues)!.push(event);
	}

	// Create series config for each unique key combination and metric field
	const seriesConfigs: ChartSeriesConfig[] = [];

	const sortedKeys = Array.from(groupedData.keys()).sort();

	for (const keyValue of sortedKeys) {
		for (const metricField of metricFields) {
			// Create a descriptive label from key values
			const keyParts = keyValue.split('|');
			const keyLabel =
				keyFields.length === 1
					? keyParts[0]
					: keyFields.map((f, i) => `${f.name}=${keyParts[i]}`).join(', ');

			const label = metricFields.length > 1 ? `${keyLabel} (${metricField.name})` : keyLabel;

			// Use stable color based on key+field combination for consistency
			const colorKey = `${keyValue}|${metricField.fullName}`;

			seriesConfigs.push({
				field: metricField.fullName,
				label: label || metricField.name,
				type: getChartTypeFromMetricType(
					metricField.annotations?.['metrics.type'] || 'gauge',
					metricField.annotations
				),
				color: metricField.annotations?.['chart.color'] || getStableColor(colorKey),
				fillOpacity: 0.2,
				interpolation: getInterpolation(metricField.annotations),
				showDots: getShowDots(metricField.annotations),
				// Store key info for filtering
				keyValue
			});
		}
	}

	return { groupedData, seriesConfigs };
}

/**
 * Find the timestamp field for x-axis
 */
export function findTimestampField(fields: DatasourceField[]): string | null {
	// First check for explicit annotation
	const annotated = fields.find((f) => f.annotations?.['chart.xaxis'] === 'true');
	if (annotated) return annotated.fullName;

	// Then look for Time kind
	const timeField = fields.find((f) => f.kind === 'Time');
	if (timeField) return timeField.fullName;

	// Check for common timestamp field names
	const timestampNames = ['timestamp', 'time', 'ts', 'created_at'];
	const byName = fields.find(
		(f) =>
			timestampNames.includes(f.name.toLowerCase()) ||
			timestampNames.includes(f.fullName.toLowerCase())
	);
	if (byName) return byName.fullName;

	return null;
}

/**
 * Extract timestamp configuration from datasource.
 * Checks for metrics.timestamp annotation on datasource or field,
 * falls back to finding Time-type fields, then _receivedAt.
 */
export function extractTimestampConfig(ds: {
	fields: DatasourceField[];
	annotations?: Record<string, string>;
}): TimestampConfig {
	// 1. Check datasource-level metrics.timestamp annotation (points to field name)
	const annotatedFieldName = ds.annotations?.['metrics.timestamp'];
	if (annotatedFieldName) {
		const field = ds.fields.find(
			(f) => f.fullName === annotatedFieldName || f.name === annotatedFieldName
		);
		if (field) {
			return { timestampField: field.fullName, useReceivedAt: false };
		}
	}

	// 2. Check field-level metrics.timestamp annotation
	const fieldWithAnnotation = ds.fields.find(
		(f) => f.annotations?.['metrics.timestamp'] === 'true'
	);
	if (fieldWithAnnotation) {
		return { timestampField: fieldWithAnnotation.fullName, useReceivedAt: false };
	}

	// 3. Fall back to existing findTimestampField logic
	const existingTimestamp = findTimestampField(ds.fields);
	if (existingTimestamp) {
		return { timestampField: existingTimestamp, useReceivedAt: false };
	}

	// 4. Use _receivedAt as fallback for array datasources
	return { timestampField: null, useReceivedAt: true };
}

/**
 * Get color at index, cycling through defaults
 */
export function getSeriesColor(index: number): string {
	return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

/**
 * Fill gaps in time series data with zero values for missing keys.
 *
 * When metrics come in batches, some keys may be missing from certain batches.
 * This function ensures that all keys have values at all timestamps:
 * - Forward fill: keys get zero values for future timestamps where they're missing
 * - Backfill: when a new key appears, it gets zero values for all previous timestamps
 *
 * @param events - Array of event data (must be sorted by timestamp, oldest first)
 * @param keyFields - Fields that define the grouping keys
 * @param metricFields - Fields containing the metric values
 * @param timestampField - The field name containing the timestamp (or 'timestamp' if using _receivedAt)
 * @returns Array of events with gaps filled with zero values
 */
export function fillGapsWithZeros(
	events: Record<string, unknown>[],
	keyFields: DatasourceField[],
	metricFields: DatasourceField[],
	timestampField: string = 'timestamp'
): Record<string, unknown>[] {
	if (!events.length || !keyFields.length || !metricFields.length) {
		return events;
	}

	const keyFieldNames = keyFields.map((f) => f.fullName);
	const metricFieldNames = metricFields.map((f) => f.fullName);

	// First pass: collect all unique keys and group events by timestamp
	const allKeys = new Set<string>();
	const eventsByTimestamp = new Map<number, Map<string, Record<string, unknown>>>();

	for (const event of events) {
		const ts = event[timestampField];
		const timestamp = ts instanceof Date ? ts.getTime() : Number(ts) || 0;
		const keyValue = keyFieldNames.map((k) => String(event[k] ?? '')).join('|');

		allKeys.add(keyValue);

		if (!eventsByTimestamp.has(timestamp)) {
			eventsByTimestamp.set(timestamp, new Map());
		}
		eventsByTimestamp.get(timestamp)!.set(keyValue, event);
	}

	// Sort timestamps
	const sortedTimestamps = Array.from(eventsByTimestamp.keys()).sort((a, b) => a - b);

	// Helper to create a zero-filled event
	const createFilledEvent = (timestamp: number, keyValue: string): Record<string, unknown> => {
		const keyParts = keyValue.split('|');
		const filledEvent: Record<string, unknown> = {
			[timestampField]: new Date(timestamp),
			_filled: true // Mark as synthetic for debugging
		};

		// Set key field values
		keyFieldNames.forEach((fieldName, i) => {
			filledEvent[fieldName] = keyParts[i];
		});

		// Set metric fields to zero
		for (const metricField of metricFieldNames) {
			filledEvent[metricField] = 0;
		}

		return filledEvent;
	};

	// Second pass: build result ensuring all keys exist at all timestamps
	const result: Record<string, unknown>[] = [];

	for (const timestamp of sortedTimestamps) {
		const eventsAtTime = eventsByTimestamp.get(timestamp)!;

		// For each known key, ensure there's an event at this timestamp
		for (const keyValue of allKeys) {
			if (eventsAtTime.has(keyValue)) {
				// Event exists, add it
				result.push(eventsAtTime.get(keyValue)!);
			} else {
				// Create a zero-filled event for this missing key
				result.push(createFilledEvent(timestamp, keyValue));
			}
		}
	}

	return result;
}

/**
 * Get the counter mode from field annotation.
 * Defaults to 'raw' if not specified.
 */
export function getCounterMode(field: DatasourceField): CounterMode {
	const mode = field.annotations?.['metrics.counter.mode'];
	if (mode === 'rate' || mode === 'delta') {
		return mode;
	}
	return 'raw';
}

/**
 * Calculate rate/delta for counter metrics between consecutive snapshots.
 *
 * For each unique key combination, tracks previous values and computes:
 * - 'rate': per-second rate of change (delta / time_diff_seconds)
 * - 'delta': raw difference between consecutive values
 * - 'raw': no calculation, returns events unchanged
 *
 * @param events - Array of events sorted by timestamp (oldest first)
 * @param keyFields - Fields that define the grouping keys
 * @param counterFields - Counter metric fields to calculate rates for
 * @param mode - 'rate' for per-second rate, 'delta' for raw difference, 'raw' for no calculation
 * @returns Events with additional _rate_{field} or _delta_{field} fields for each counter
 */
export function calculateCounterRates(
	events: Record<string, unknown>[],
	keyFields: DatasourceField[],
	counterFields: DatasourceField[],
	mode: CounterMode = 'raw'
): Record<string, unknown>[] {
	if (mode === 'raw' || !events.length || !counterFields.length) {
		return events;
	}

	const keyFieldNames = keyFields.map((f) => f.fullName);
	const counterFieldNames = counterFields.map((f) => f.fullName);

	// Track previous values per key combination
	const previousValues = new Map<
		string,
		{
			timestamp: number;
			values: Record<string, number>;
		}
	>();

	const result: Record<string, unknown>[] = [];

	for (const event of events) {
		const keyValue =
			keyFieldNames.length > 0
				? keyFieldNames.map((k) => String(event[k] ?? '')).join('|')
				: '__default__';

		const timestamp =
			event.timestamp instanceof Date
				? event.timestamp.getTime()
				: typeof event.timestamp === 'number'
					? event.timestamp
					: (event._receivedAt as number) || 0;

		const newEvent = { ...event };
		const prev = previousValues.get(keyValue);

		if (prev && timestamp > prev.timestamp) {
			const timeDeltaSeconds = (timestamp - prev.timestamp) / 1000;

			for (const fieldName of counterFieldNames) {
				const currentValue = Number(event[fieldName]) || 0;
				const previousValue = prev.values[fieldName] || 0;
				const valueDelta = currentValue - previousValue;

				if (mode === 'rate' && timeDeltaSeconds > 0) {
					// Per-second rate
					newEvent[`_rate_${fieldName}`] = valueDelta / timeDeltaSeconds;
				} else {
					// Raw delta
					newEvent[`_delta_${fieldName}`] = Math.max(0, valueDelta); // Clamp to 0 for counter resets
				}
			}
		} else {
			// First occurrence - set rate/delta to 0
			for (const fieldName of counterFieldNames) {
				const prefix = mode === 'rate' ? '_rate_' : '_delta_';
				newEvent[`${prefix}${fieldName}`] = 0;
			}
		}

		// Update previous values for this key
		const currentValues: Record<string, number> = {};
		for (const fieldName of counterFieldNames) {
			currentValues[fieldName] = Number(event[fieldName]) || 0;
		}
		previousValues.set(keyValue, { timestamp, values: currentValues });

		result.push(newEvent);
	}

	return result;
}

/**
 * Aggregate events by timestamp, summing metric values.
 * Used when no key fields are defined to combine multiple events at the same timestamp.
 *
 * @param events - Array of events sorted by timestamp (oldest first)
 * @param metricFields - Fields containing metric values to sum
 * @param timestampField - Field name containing the timestamp (default: 'timestamp')
 * @returns Array of aggregated events with one entry per unique timestamp
 */
export function aggregateByTimestamp(
	events: Record<string, unknown>[],
	metricFields: DatasourceField[],
	timestampField: string = 'timestamp'
): Record<string, unknown>[] {
	if (!events.length || !metricFields.length) {
		return events;
	}

	const metricFieldNames = metricFields.map((f) => f.fullName);
	const aggregated = new Map<number, Record<string, unknown>>();

	for (const event of events) {
		const ts = event[timestampField];
		const timestamp = ts instanceof Date ? ts.getTime() : Number(ts) || 0;

		if (aggregated.has(timestamp)) {
			// Add to existing aggregation
			const existing = aggregated.get(timestamp)!;
			for (const fieldName of metricFieldNames) {
				const currentValue = Number(existing[fieldName]) || 0;
				const newValue = Number(event[fieldName]) || 0;
				existing[fieldName] = currentValue + newValue;
			}
		} else {
			// Start new aggregation - copy the event
			const newEntry: Record<string, unknown> = {
				[timestampField]: event[timestampField],
				_batchId: event._batchId,
				_receivedAt: event._receivedAt
			};
			for (const fieldName of metricFieldNames) {
				newEntry[fieldName] = Number(event[fieldName]) || 0;
			}
			aggregated.set(timestamp, newEntry);
		}
	}

	// Return sorted by timestamp
	return Array.from(aggregated.values()).sort((a, b) => {
		const tsA = a[timestampField];
		const tsB = b[timestampField];
		const timeA = tsA instanceof Date ? tsA.getTime() : Number(tsA) || 0;
		const timeB = tsB instanceof Date ? tsB.getTime() : Number(tsB) || 0;
		return timeA - timeB;
	});
}

/**
 * Extract histogram configuration from datasource fields.
 * Looks for metrics.histogram.bucket and metrics.histogram.count annotations.
 */
export function extractHistogramConfig(ds: { fields: DatasourceField[] }): HistogramConfig {
	const bucketField = ds.fields.find((f) => f.annotations?.['metrics.histogram.bucket'] === 'true');
	const countField = ds.fields.find(
		(f) =>
			f.annotations?.['metrics.histogram.count'] === 'true' ||
			f.annotations?.['metrics.type'] === 'histogram'
	);

	return {
		bucketField: bucketField || null,
		countField: countField || null,
		isHistogram: !!(bucketField && countField)
	};
}

/**
 * Transform histogram data for bar chart visualization.
 * Groups by bucket boundaries and aggregates counts per key combination.
 *
 * @param events - Array of event data
 * @param bucketField - Field name containing bucket boundaries
 * @param countField - Field name containing count values
 * @param keyFields - Optional key fields for grouping (creates multiple series)
 * @returns Object with bucket labels and series data for each key
 */
export function transformHistogramData(
	events: Record<string, unknown>[],
	bucketField: string,
	countField: string,
	keyFields: DatasourceField[] = []
): {
	buckets: string[];
	seriesData: Map<string, number[]>;
} {
	const keyFieldNames = keyFields.map((f) => f.fullName);
	const bucketCounts = new Map<string, Map<string, number>>();
	const allBuckets = new Set<string>();

	for (const event of events) {
		const bucket = String(event[bucketField] ?? 'unknown');
		const count = Number(event[countField]) || 0;
		const keyValue =
			keyFieldNames.length > 0
				? keyFieldNames.map((k) => String(event[k] ?? '')).join('|')
				: 'default';

		allBuckets.add(bucket);

		if (!bucketCounts.has(keyValue)) {
			bucketCounts.set(keyValue, new Map());
		}
		const keyMap = bucketCounts.get(keyValue)!;
		keyMap.set(bucket, (keyMap.get(bucket) || 0) + count);
	}

	// Sort buckets (try numeric, fall back to string)
	const buckets = Array.from(allBuckets).sort((a, b) => {
		const numA = parseFloat(a);
		const numB = parseFloat(b);
		if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
		return a.localeCompare(b);
	});

	// Build series data
	const seriesData = new Map<string, number[]>();
	for (const [keyValue, countMap] of bucketCounts) {
		seriesData.set(
			keyValue,
			buckets.map((b) => countMap.get(b) || 0)
		);
	}

	return { buckets, seriesData };
}
