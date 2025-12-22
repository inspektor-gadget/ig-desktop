<script lang="ts">
	import MetricsChart from '../charts/MetricsChart.svelte';
	import HistogramChart from '../charts/HistogramChart.svelte';
	import {
		extractMetricFields,
		extractTimestampConfig,
		extractHistogramConfig,
		groupEventsByKeys,
		fillGapsWithZeros,
		calculateCounterRates,
		getCounterMode,
		aggregateByTimestamp
	} from '$lib/utils/chartConfig';
	import type { Datasource, ChartSeriesConfig, CounterMode } from '$lib/types/charts';
	import type { EventRingBuffer } from '$lib/utils/ring-buffer';

	/** Default chart colors for series without explicit color annotations */
	const DEFAULT_CHART_COLORS = ['#77bb41', '#3b82f6', '#f59e0b', '#ef4444'];

	interface Props {
		ds: Datasource;
		events?: EventRingBuffer<Record<string, unknown>>;
		/** Version counter to trigger re-reads of the ring buffer */
		eventVersion?: number;
		/** Fill gaps with zero values for missing keys (default: true) */
		fillGaps?: boolean;
	}

	let { ds, events, eventVersion = 0, fillGaps = true }: Props = $props();

	// Convert ring buffer to array for chart processing
	// eventVersion dependency triggers re-read when new events arrive
	const eventsArray = $derived.by(() => {
		// Track eventVersion for reactivity (intentionally read to trigger updates)
		void eventVersion;
		return events?.toArray() ?? [];
	});

	// Extract key and metric fields from datasource annotations
	const { keyFields, metricFields } = $derived(extractMetricFields(ds));

	// Extract timestamp configuration
	const timestampConfig = $derived(extractTimestampConfig(ds));

	// Check for histogram configuration
	const histogramConfig = $derived(extractHistogramConfig(ds));

	// Separate counter fields for rate calculation
	const counterFields = $derived(
		metricFields.filter((f) => f.annotations?.['metrics.type'] === 'counter')
	);

	// Determine counter mode (use first counter field's mode, default to 'raw')
	const counterMode = $derived<CounterMode>(
		counterFields.length > 0 ? getCounterMode(counterFields[0]) : 'raw'
	);

	// Chart event type with required timestamp
	type ChartEvent = Record<string, unknown> & { timestamp: Date };

	// Transform events to chart-compatible format with timestamps
	// Events come newest-first, charts need oldest-first
	const chartData = $derived.by(() => {
		if (!eventsArray.length) {
			return [] as ChartEvent[];
		}

		let transformed: ChartEvent[] = eventsArray
			.map((evt) => {
				let timestamp: Date;

				// Use timestamp config to determine timestamp source
				if (
					!timestampConfig.useReceivedAt &&
					timestampConfig.timestampField &&
					evt[timestampConfig.timestampField] != null
				) {
					// Use field specified by metrics.timestamp annotation
					const ts = evt[timestampConfig.timestampField];
					timestamp =
						ts instanceof Date
							? ts
							: typeof ts === 'number'
								? new Date(ts / 1_000_000) // nanoseconds to milliseconds
								: typeof ts === 'string'
									? new Date(ts)
									: new Date((evt._receivedAt as number) || Date.now());
				} else if (evt._receivedAt) {
					// Use the timestamp when we received this event (for array batches)
					timestamp = new Date(evt._receivedAt as number);
				} else {
					// Fallback to current time
					timestamp = new Date();
				}

				return {
					...evt,
					timestamp
				};
			})
			.reverse(); // Reverse to get oldest-first for chart

		// Apply counter rate calculation if needed
		if (counterFields.length > 0 && counterMode !== 'raw') {
			transformed = calculateCounterRates(
				transformed,
				keyFields,
				counterFields,
				counterMode
			) as ChartEvent[];
		}

		// Apply gap filling if enabled and we have key-based grouping
		if (fillGaps && keyFields.length > 0 && metricFields.length > 0) {
			return fillGapsWithZeros(transformed, keyFields, metricFields, 'timestamp');
		}

		return transformed;
	});

	// Build metric fields for series (adjust for rate mode)
	const effectiveMetricFields = $derived.by(() => {
		if (counterFields.length === 0 || counterMode === 'raw') {
			return metricFields;
		}

		// For rate/delta mode, adjust counter field names to use calculated fields
		return metricFields.map((f) => {
			if (f.annotations?.['metrics.type'] === 'counter') {
				const prefix = counterMode === 'rate' ? '_rate_' : '_delta_';
				return {
					...f,
					fullName: `${prefix}${f.fullName}`,
					name: `${counterMode === 'rate' ? 'Rate' : 'Delta'}: ${f.name}`
				};
			}
			return f;
		});
	});

	// Aggregate data by timestamp when no key fields are defined
	// This ensures multiple entries at the same timestamp are summed into one point
	const finalChartData = $derived.by(() => {
		if (keyFields.length === 0 && effectiveMetricFields.length > 0) {
			return aggregateByTimestamp(chartData, effectiveMetricFields, 'timestamp');
		}
		return chartData;
	});

	// Group data by key fields and create dynamic series
	const { groupedData, seriesConfigs } = $derived.by(() => {
		if (!finalChartData.length || !keyFields.length || !effectiveMetricFields.length) {
			// No key-based grouping, fall back to simple series
			return {
				groupedData: new Map<string, Record<string, unknown>[]>(),
				seriesConfigs: effectiveMetricFields.map((field, i) => ({
					field: field.fullName,
					label: field.annotations?.['description'] || field.name,
					type: (field.annotations?.['chart.type'] || 'line') as ChartSeriesConfig['type'],
					color:
						field.annotations?.['chart.color'] ||
						DEFAULT_CHART_COLORS[i % DEFAULT_CHART_COLORS.length],
					fillOpacity: 0.2,
					interpolation: (field.annotations?.['chart.interpolation'] === 'smooth' ||
					field.annotations?.['chart.interpolation'] === 'curve'
						? 'smooth'
						: 'linear') as 'linear' | 'smooth',
					showDots: field.annotations?.['chart.dots'] !== 'false'
				}))
			};
		}

		return groupEventsByKeys(finalChartData, keyFields, effectiveMetricFields);
	});

	// Check if we're using key-based grouping
	const hasKeyGrouping = $derived(keyFields.length > 0 && effectiveMetricFields.length > 0);
</script>

{#if histogramConfig.isHistogram && histogramConfig.bucketField && histogramConfig.countField}
	<HistogramChart
		data={finalChartData}
		bucketField={histogramConfig.bucketField.fullName}
		countField={histogramConfig.countField.fullName}
		{keyFields}
	/>
{:else}
	<MetricsChart
		data={finalChartData}
		series={seriesConfigs}
		{groupedData}
		{hasKeyGrouping}
	/>
{/if}
