<script lang="ts">
	import * as d3 from 'd3';
	import Chart from './Chart/Chart.svelte';
	import Axis from './Chart/Axis.svelte';
	import Grid from './Chart/Grid.svelte';
	import { transformHistogramData, getStableColor } from '$lib/utils/chartConfig';
	import type { ChartDimensions, DatasourceField } from '$lib/types/charts';

	interface Props {
		data: Record<string, unknown>[];
		bucketField: string;
		countField: string;
		keyFields?: DatasourceField[];
		height?: number;
		showLegend?: boolean;
	}

	let {
		data = [],
		bucketField,
		countField,
		keyFields = [],
		height = 200,
		showLegend = true
	}: Props = $props();

	// Transform data into histogram format
	const histogramData = $derived(transformHistogramData(data, bucketField, countField, keyFields));

	// Container width is dynamic
	let containerWidth = $state(400);

	const margins = {
		marginTop: 16,
		marginRight: 16,
		marginBottom: 40,
		marginLeft: 50
	};

	const dimensions: ChartDimensions = $derived({
		width: containerWidth,
		height,
		...margins,
		boundedWidth: Math.max(containerWidth - margins.marginLeft - margins.marginRight, 0),
		boundedHeight: Math.max(height - margins.marginTop - margins.marginBottom, 0)
	});

	// X scale (band scale for buckets)
	const xScale = $derived.by(() => {
		return d3
			.scaleBand<string>()
			.domain(histogramData.buckets)
			.range([0, dimensions.boundedWidth])
			.padding(0.1);
	});

	// Calculate the maximum value across all series for y scale
	const maxValue = $derived.by(() => {
		let max = 0;
		for (const counts of histogramData.seriesData.values()) {
			const seriesMax = Math.max(...counts);
			if (seriesMax > max) max = seriesMax;
		}
		return max || 100;
	});

	// Y scale (linear for counts)
	const yScale = $derived.by(() => {
		return d3
			.scaleLinear()
			.domain([0, maxValue * 1.1]) // 10% headroom
			.range([dimensions.boundedHeight, 0])
			.nice();
	});

	// Get series keys and colors
	const seriesKeys = $derived(Array.from(histogramData.seriesData.keys()));
	const seriesColors = $derived(
		seriesKeys.map((key) => ({
			key,
			color: getStableColor(key)
		}))
	);
	// O(1) color lookup map for performance in nested loops
	const colorMap = $derived(new Map(seriesColors.map((s) => [s.key, s.color])));

	// Calculate bar width for grouped bars
	const barWidth = $derived.by(() => {
		const bandwidth = xScale.bandwidth();
		const numSeries = Math.max(seriesKeys.length, 1);
		return Math.max(2, bandwidth / numSeries - 1);
	});

	// Format functions
	const formatValue = d3.format('.2s');

	// Tooltip state
	let tooltipData = $state<{
		bucket: string;
		values: { key: string; value: number; color: string }[];
		x: number;
		y: number;
	} | null>(null);

	function handleBarHover(event: MouseEvent, bucket: string) {
		const rect = (event.target as SVGRectElement).getBoundingClientRect();
		const bucketIndex = histogramData.buckets.indexOf(bucket);

		// Collect all values at this bucket
		const values = seriesKeys.map((key) => {
			const counts = histogramData.seriesData.get(key) || [];
			return {
				key,
				value: counts[bucketIndex] || 0,
				color: colorMap.get(key) || '#888'
			};
		});

		tooltipData = {
			bucket,
			values,
			x: rect.left + rect.width / 2,
			y: rect.top
		};
	}

	function handleBarLeave() {
		tooltipData = null;
	}
</script>

<div class="histogram-chart" bind:clientWidth={containerWidth}>
	{#if histogramData.buckets.length > 0}
		<Chart {dimensions}>
			<!-- Grid lines -->
			<Grid {xScale} {yScale} />

			<Axis dimension="x" scale={xScale} formatTick={(d: unknown) => String(d)} label="" />
			<Axis dimension="y" scale={yScale} formatTick={formatValue} label="" />

			<!-- Bars -->
			<g class="bars">
				{#each histogramData.buckets as bucket, bucketIndex (bucket)}
					{#each seriesKeys as seriesKey, seriesIndex (seriesKey)}
						{@const counts = histogramData.seriesData.get(seriesKey) || []}
						{@const value = counts[bucketIndex] || 0}
						{@const color = colorMap.get(seriesKey) || '#888'}
						{@const x =
							(xScale(bucket) || 0) +
							(seriesKeys.length > 1
								? seriesIndex * barWidth
								: xScale.bandwidth() / 2 - barWidth / 2)}
						{@const barHeight = dimensions.boundedHeight - yScale(value)}
						<rect
							class="histogram-bar"
							{x}
							y={yScale(value)}
							width={seriesKeys.length > 1 ? barWidth : xScale.bandwidth()}
							height={Math.max(0, barHeight)}
							fill={color}
							opacity="0.8"
							rx="1"
							ry="1"
							role="graphics-symbol"
							aria-label="{seriesKey}: {value}"
							onmouseenter={(e) => handleBarHover(e, bucket)}
							onmouseleave={handleBarLeave}
						/>
					{/each}
				{/each}
			</g>
		</Chart>

		<!-- Tooltip -->
		{#if tooltipData}
			<div class="tooltip-panel" style="left: {tooltipData.x}px; top: {tooltipData.y}px;">
				<div class="tooltip-bucket">Bucket: {tooltipData.bucket}</div>
				{#each tooltipData.values as v (v.key)}
					<div class="tooltip-row">
						<span class="tooltip-color" style="background-color: {v.color}"></span>
						<span class="tooltip-label">{v.key}</span>
						<span class="tooltip-value">{v.value.toLocaleString()}</span>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Legend -->
		{#if showLegend && seriesKeys.length > 1}
			<div class="chart-legend">
				{#each seriesColors as { key, color } (key)}
					<div class="legend-item">
						<span class="legend-color" style="background-color: {color}"></span>
						<span class="legend-label">{key}</span>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="flex h-full items-center justify-center text-sm text-gray-500">
			Waiting for histogram data...
		</div>
	{/if}
</div>

<style>
	.histogram-chart {
		width: 100%;
		position: relative;
	}

	.histogram-bar {
		transition: opacity 0.15s ease;
		cursor: pointer;
	}

	.histogram-bar:hover {
		opacity: 1 !important;
	}

	.tooltip-panel {
		position: fixed;
		transform: translate(-50%, -100%) translateY(-8px);
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #d1d5db;
		border-radius: 6px;
		padding: 8px 12px;
		font-size: 12px;
		pointer-events: none;
		z-index: 50;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		min-width: 120px;
	}

	:where(.dark, .dark *) .tooltip-panel {
		background: rgba(17, 24, 39, 0.95);
		border: 1px solid #374151;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}

	.tooltip-bucket {
		color: #4b5563;
		font-size: 11px;
		margin-bottom: 6px;
		padding-bottom: 4px;
		border-bottom: 1px solid #d1d5db;
		font-family: monospace;
	}

	:where(.dark, .dark *) .tooltip-bucket {
		color: #9ca3af;
		border-bottom: 1px solid #374151;
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
	}

	.tooltip-color {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.tooltip-label {
		color: #374151;
		flex: 1;
	}

	:where(.dark, .dark *) .tooltip-label {
		color: #d1d5db;
	}

	.tooltip-value {
		color: #111827;
		font-family: monospace;
		font-weight: 500;
	}

	:where(.dark, .dark *) .tooltip-value {
		color: #f3f4f6;
	}

	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px 16px;
		padding: 8px 12px;
		margin-top: 4px;
		background: rgba(249, 250, 251, 0.5);
		border-top: 1px solid #d1d5db;
		border-radius: 0 0 6px 6px;
	}

	:where(.dark, .dark *) .chart-legend {
		background: rgba(17, 24, 39, 0.5);
		border-top: 1px solid #374151;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #374151;
		cursor: default;
		transition: opacity 0.15s ease;
	}

	:where(.dark, .dark *) .legend-item {
		color: #d1d5db;
	}

	.legend-item:hover {
		opacity: 0.8;
	}

	.legend-color {
		width: 14px;
		height: 3px;
		border-radius: 1px;
		flex-shrink: 0;
	}

	.legend-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 200px;
	}
</style>
