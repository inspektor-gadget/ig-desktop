<script lang="ts">
	import * as d3 from 'd3';
	import Chart from './Chart/Chart.svelte';
	import Line from './Chart/Line.svelte';
	import Axis from './Chart/Axis.svelte';
	import Gradient from './Chart/Gradient.svelte';
	import Grid from './Chart/Grid.svelte';
	import Tooltip from './Chart/Tooltip.svelte';
	import BarSeries from './BarSeries.svelte';
	import { getUniqueId } from './Chart/utils';
	import type { ChartSeriesConfig, ChartDimensions } from '$lib/types/charts';

	// Time range options
	const timeRanges = [
		{ label: 'Last 1 min', value: 60 * 1000 },
		{ label: 'Last 5 min', value: 5 * 60 * 1000 },
		{ label: 'Last 15 min', value: 15 * 60 * 1000 },
		{ label: 'Last 30 min', value: 30 * 60 * 1000 },
		{ label: 'Last 1 hour', value: 60 * 60 * 1000 },
		{ label: 'All data', value: 0 }
	];

	interface Props {
		data: Record<string, unknown>[];
		series: ChartSeriesConfig[];
		height?: number;
		xAccessor?: (d: Record<string, unknown>) => Date;
		showLegend?: boolean;
		/** Grouped data by key values (for metrics with key fields) */
		groupedData?: Map<string, Record<string, unknown>[]>;
		/** Whether key-based grouping is active */
		hasKeyGrouping?: boolean;
	}

	let {
		data = [],
		series = [],
		height = 200,
		xAccessor = (d) => d.timestamp as Date,
		showLegend = true,
		groupedData = new Map(),
		hasKeyGrouping = false
	}: Props = $props();

	// Time range state
	let selectedTimeRange = $state(timeRanges[0].value);

	// Custom zoom range (when user drags to select)
	let zoomRange = $state<{ start: Date; end: Date } | null>(null);

	// Brush selection state
	let brushStart = $state<number | null>(null);
	let brushEnd = $state<number | null>(null);
	let isBrushing = $state(false);

	/** Filter data by current time range or zoom selection */
	function filterByTimeRange(dataToFilter: Record<string, unknown>[]): Record<string, unknown>[] {
		if (!dataToFilter.length) return dataToFilter;

		// If we have a custom zoom range, use that
		if (zoomRange) {
			const range = zoomRange;
			return dataToFilter.filter((d) => {
				const timestamp = xAccessor(d);
				return (
					timestamp &&
					timestamp.getTime() >= range.start.getTime() &&
					timestamp.getTime() <= range.end.getTime()
				);
			});
		}

		// Otherwise use the dropdown selection
		if (selectedTimeRange === 0) return dataToFilter;
		const now = Date.now();
		const cutoff = now - selectedTimeRange;
		return dataToFilter.filter((d) => {
			const timestamp = xAccessor(d);
			return timestamp && timestamp.getTime() >= cutoff;
		});
	}

	// Filter data based on selected time range or custom zoom
	const filteredData = $derived.by(() => filterByTimeRange(data));

	// Reset zoom when time range dropdown changes
	function handleTimeRangeChange() {
		zoomRange = null;
	}

	// Container width is dynamic, height is fixed
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

	// X scale (time)
	const xScale = $derived.by(() => {
		if (!filteredData.length) return d3.scaleTime().range([0, dimensions.boundedWidth]);
		const extent = d3.extent(filteredData, xAccessor) as [Date, Date];
		return d3.scaleTime().domain(extent).range([0, dimensions.boundedWidth]);
	});

	// Get data for a specific series (handles key-based grouping)
	function getSeriesData(s: ChartSeriesConfig): Record<string, unknown>[] {
		if (hasKeyGrouping && s.keyValue && groupedData.has(s.keyValue)) {
			return filterByTimeRange(groupedData.get(s.keyValue) || []);
		}
		return filteredData;
	}

	/** Find the closest data point to a given x-value using binary search */
	function findClosestDataPoint(
		dataArray: Record<string, unknown>[],
		xValue: Date
	): Record<string, unknown> | undefined {
		if (!dataArray.length) return undefined;
		const idx = bisect(dataArray, xValue, 1);
		const d0 = dataArray[idx - 1];
		const d1 = dataArray[idx];

		if (!d1) return d0;
		if (!d0) return d1;
		return xValue.getTime() - xAccessor(d0).getTime() > xAccessor(d1).getTime() - xValue.getTime()
			? d1
			: d0;
	}

	// Y scale (auto from all series)
	const yScale = $derived.by(() => {
		if (!filteredData.length || !series.length) {
			return d3.scaleLinear().domain([0, 100]).range([dimensions.boundedHeight, 0]);
		}

		let allValues: number[];

		if (hasKeyGrouping) {
			// Collect values from all grouped series
			allValues = series
				.flatMap((s) => {
					const seriesData = getSeriesData(s);
					return seriesData.map((d) => d[s.field] as number);
				})
				.filter((v) => v != null && !isNaN(v));
		} else {
			allValues = series
				.flatMap((s) => filteredData.map((d) => d[s.field] as number))
				.filter((v) => v != null && !isNaN(v));
		}

		if (allValues.length === 0) {
			return d3.scaleLinear().domain([0, 100]).range([dimensions.boundedHeight, 0]);
		}

		const extent = d3.extent(allValues) as [number, number];
		return d3
			.scaleLinear()
			.domain([Math.min(0, extent[0]), extent[1] * 1.1]) // Add 10% headroom
			.range([dimensions.boundedHeight, 0])
			.nice();
	});

	// Generate gradient IDs for area charts
	const gradientIds = $derived(
		series.map((s, i) => getUniqueId(`gradient-${s.field}-${s.keyValue || i}`))
	);

	// Format functions
	const formatDate = d3.timeFormat('%H:%M:%S');
	const formatValue = d3.format('.2s');
	const formatTooltipTime = d3.timeFormat('%H:%M:%S.%L');

	// Create accessors for each series
	const seriesAccessors = $derived(
		series.map((s) => ({
			x: (d: Record<string, unknown>) => xScale(xAccessor(d)),
			y: (d: Record<string, unknown>) => yScale((d[s.field] as number) ?? 0),
			y0: yScale(0),
			getData: () => getSeriesData(s)
		}))
	);

	// Create gradient colors (main color to transparent)
	function getGradientColors(color: string): [string, string] {
		return [color + '60', color + '00']; // 40% opacity to transparent
	}

	// Tooltip state
	let tooltipData = $state<{
		x: number;
		time: Date;
		values: { label: string; value: number; rawValue: number; color: string }[];
	} | null>(null);
	let tooltipPosition = $state<{ x: number; y: number } | null>(null);

	// Bisector for finding closest data point
	const bisect = d3.bisector((d: Record<string, unknown>) => xAccessor(d)).left;

	function handleMouseMove(event: MouseEvent) {
		if (!filteredData.length || !series.length) return;

		const svg = (event.currentTarget as SVGRectElement).ownerSVGElement;
		if (!svg) return;

		const point = svg.createSVGPoint();
		point.x = event.clientX;
		point.y = event.clientY;
		const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());

		// Adjust for margins
		const x = svgPoint.x - margins.marginLeft;
		const y = svgPoint.y - margins.marginTop;

		// Clamp to chart bounds
		if (x < 0 || x > dimensions.boundedWidth || y < 0 || y > dimensions.boundedHeight) {
			tooltipData = null;
			tooltipPosition = null;
			return;
		}

		// Find the closest data point
		const xValue = xScale.invert(x);
		const closestData = findClosestDataPoint(filteredData, xValue);
		if (!closestData) {
			tooltipData = null;
			tooltipPosition = null;
			return;
		}

		const closestX = xScale(xAccessor(closestData));

		// Build tooltip data - for key-based grouping, find closest point in each series
		const tooltipValues = series.map((s) => {
			let rawValue: number;

			if (hasKeyGrouping && s.keyValue) {
				// Find the closest data point in this series' data
				const seriesData = getSeriesData(s);
				const closest = findClosestDataPoint(seriesData, xValue);
				rawValue = (closest?.[s.field] as number) ?? 0;
			} else {
				rawValue = (closestData[s.field] as number) ?? 0;
			}

			return {
				label: s.label,
				value: yScale(rawValue),
				rawValue,
				color: s.color
			};
		});

		tooltipData = {
			x: closestX,
			time: xAccessor(closestData),
			values: tooltipValues
		};

		// Position tooltip (in page coordinates)
		const rect = svg.getBoundingClientRect();
		tooltipPosition = {
			x: rect.left + margins.marginLeft + closestX,
			y: rect.top + margins.marginTop
		};
	}

	function handleMouseLeave() {
		tooltipData = null;
		tooltipPosition = null;
	}

	// Brush handlers for zoom selection
	function getMouseX(event: MouseEvent): number | null {
		const svg = (event.currentTarget as SVGRectElement).ownerSVGElement;
		if (!svg) return null;

		const point = svg.createSVGPoint();
		point.x = event.clientX;
		point.y = event.clientY;
		const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());

		const x = svgPoint.x - margins.marginLeft;
		if (x < 0 || x > dimensions.boundedWidth) return null;
		return x;
	}

	function handleBrushStart(event: MouseEvent) {
		const x = getMouseX(event);
		if (x === null) return;

		isBrushing = true;
		brushStart = x;
		brushEnd = x;

		// Hide tooltip while brushing
		tooltipData = null;
		tooltipPosition = null;
	}

	function handleBrushMove(event: MouseEvent) {
		if (!isBrushing) {
			handleMouseMove(event);
			return;
		}

		const x = getMouseX(event);
		if (x === null) return;

		brushEnd = x;
	}

	function handleBrushEnd() {
		if (!isBrushing) return;

		isBrushing = false;

		if (brushStart !== null && brushEnd !== null) {
			const startX = Math.min(brushStart, brushEnd);
			const endX = Math.max(brushStart, brushEnd);

			// Only zoom if selection is at least 10px wide
			if (endX - startX > 10) {
				const startTime = xScale.invert(startX);
				const endTime = xScale.invert(endX);
				zoomRange = { start: startTime, end: endTime };
			}
		}

		brushStart = null;
		brushEnd = null;
	}

	function resetZoom() {
		zoomRange = null;
	}

	// Computed brush rectangle
	const brushRect = $derived.by(() => {
		if (!isBrushing || brushStart === null || brushEnd === null) return null;
		const x = Math.min(brushStart, brushEnd);
		const width = Math.abs(brushEnd - brushStart);
		return { x, width };
	});
</script>

<div class="metrics-chart" bind:clientWidth={containerWidth}>
	{#if data.length > 0 && series.length > 0}
		<!-- Time range selector and zoom controls -->
		<div class="chart-controls">
			{#if zoomRange}
				<button class="reset-zoom-btn" onclick={resetZoom}> Reset zoom </button>
			{/if}
			<select
				class="time-range-dropdown"
				bind:value={selectedTimeRange}
				onchange={handleTimeRangeChange}
			>
				{#each timeRanges as range (range.value)}
					<option value={range.value}>{range.label}</option>
				{/each}
			</select>
		</div>

		<!-- Zoom hint -->
		{#if !zoomRange}
			<div class="zoom-hint">Drag to zoom</div>
		{/if}

		<Chart {dimensions}>
			<defs>
				{#each series as s, i (s.field + (s.keyValue || i))}
					{#if s.type === 'area'}
						<Gradient
							id={gradientIds[i]}
							colors={getGradientColors(s.color)}
							x1="0"
							x2="0"
							y1="0"
							y2={dimensions.boundedHeight}
						/>
					{/if}
				{/each}
			</defs>

			<!-- Grid lines (behind everything) -->
			<Grid {xScale} {yScale} />

			<Axis dimension="x" scale={xScale} formatTick={formatDate} label="" />
			<Axis dimension="y" scale={yScale} formatTick={formatValue} label="" />

			{#each series as s, i (s.field + (s.keyValue || i))}
				{@const seriesData = seriesAccessors[i].getData()}
				{@const interpolation = s.interpolation === 'smooth' ? d3.curveMonotoneX : d3.curveLinear}
				{#if s.type === 'bar'}
					<BarSeries
						data={seriesData}
						xAccessor={seriesAccessors[i].x}
						yAccessor={seriesAccessors[i].y}
						{yScale}
						color={s.color}
					/>
				{:else}
					{#if s.type === 'area'}
						<Line
							type="area"
							data={seriesData}
							xAccessor={seriesAccessors[i].x}
							yAccessor={seriesAccessors[i].y}
							y0Accessor={seriesAccessors[i].y0}
							{interpolation}
							style="fill: url(#{gradientIds[i]})"
						/>
					{/if}
					<Line
						type="line"
						data={seriesData}
						xAccessor={seriesAccessors[i].x}
						yAccessor={seriesAccessors[i].y}
						{interpolation}
						style="stroke: {s.color}; stroke-width: 2px; fill: none;"
					/>
					<!-- Data point dots (only if enabled) -->
					{#if s.showDots}
						{#each seriesData as d, di (di)}
							<circle
								class="data-point"
								cx={seriesAccessors[i].x(d)}
								cy={seriesAccessors[i].y(d)}
								r={3}
								fill={s.color}
							/>
						{/each}
					{/if}
				{/if}
			{/each}

			<!-- Tooltip elements (vertical line + dots) -->
			<Tooltip data={tooltipData} />

			<!-- Brush selection rectangle -->
			{#if brushRect}
				<rect
					class="brush-selection"
					x={brushRect.x}
					y={0}
					width={brushRect.width}
					height={dimensions.boundedHeight}
				/>
			{/if}

			<!-- Invisible overlay for mouse interaction -->
			<rect
				class="hover-overlay"
				width={dimensions.boundedWidth}
				height={dimensions.boundedHeight}
				fill="transparent"
				onmousedown={handleBrushStart}
				onmousemove={handleBrushMove}
				onmouseup={handleBrushEnd}
				onmouseleave={() => {
					handleBrushEnd();
					handleMouseLeave();
				}}
			/>
		</Chart>

		<!-- Floating tooltip panel -->
		{#if tooltipData && tooltipPosition}
			<div class="tooltip-panel" style="left: {tooltipPosition.x}px; top: {tooltipPosition.y}px;">
				<div class="tooltip-time">{formatTooltipTime(tooltipData.time)}</div>
				{#each tooltipData.values as v (v.label)}
					<div class="tooltip-row">
						<span class="tooltip-color" style="background-color: {v.color}"></span>
						<span class="tooltip-label">{v.label}</span>
						<span class="tooltip-value">{v.rawValue.toLocaleString()}</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if showLegend && (series.length > 1 || hasKeyGrouping)}
			<div class="chart-legend">
				{#each series as s (s.field + (s.keyValue || s.label))}
					<div class="legend-item">
						<span class="legend-color" style="background-color: {s.color}"></span>
						<span class="legend-label">{s.label}</span>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="flex h-full items-center justify-center text-sm text-gray-500">
			{#if series.length === 0}
				No numeric fields to chart
			{:else}
				Waiting for data...
			{/if}
		</div>
	{/if}
</div>

<style>
	.metrics-chart {
		width: 100%;
		position: relative;
	}

	.chart-controls {
		position: absolute;
		top: 4px;
		right: 8px;
		z-index: 10;
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.reset-zoom-btn {
		background: rgba(99, 102, 241, 0.8);
		border: 1px solid #6366f1;
		border-radius: 4px;
		color: #fff;
		font-size: 11px;
		padding: 4px 8px;
		cursor: pointer;
		outline: none;
		transition: background 0.15s ease;
	}

	.reset-zoom-btn:hover {
		background: rgba(99, 102, 241, 1);
	}

	.zoom-hint {
		position: absolute;
		top: 4px;
		left: 56px;
		font-size: 10px;
		color: #6b7280;
		pointer-events: none;
	}

	.time-range-dropdown {
		background: rgba(31, 41, 55, 0.9);
		border: 1px solid #374151;
		border-radius: 4px;
		color: #d1d5db;
		font-size: 11px;
		padding: 4px 8px;
		cursor: pointer;
		outline: none;
	}

	.time-range-dropdown:hover {
		border-color: #4b5563;
	}

	.time-range-dropdown:focus {
		border-color: #6366f1;
	}

	.time-range-dropdown option {
		background: #1f2937;
		color: #d1d5db;
	}

	.hover-overlay {
		cursor: crosshair;
	}

	.brush-selection {
		fill: rgba(99, 102, 241, 0.2);
		stroke: #6366f1;
		stroke-width: 1;
		pointer-events: none;
	}

	.data-point {
		opacity: 0.8;
		transition: opacity 0.15s ease;
	}

	.data-point:hover {
		opacity: 1;
	}

	.tooltip-panel {
		position: fixed;
		transform: translate(-50%, -100%) translateY(-8px);
		background: rgba(17, 24, 39, 0.95);
		border: 1px solid #374151;
		border-radius: 6px;
		padding: 8px 12px;
		font-size: 12px;
		pointer-events: none;
		z-index: 50;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		min-width: 120px;
	}

	.tooltip-time {
		color: #9ca3af;
		font-size: 11px;
		margin-bottom: 6px;
		padding-bottom: 4px;
		border-bottom: 1px solid #374151;
		font-family: monospace;
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
		color: #d1d5db;
		flex: 1;
	}

	.tooltip-value {
		color: #f3f4f6;
		font-family: monospace;
		font-weight: 500;
	}

	/* Grafana-style legend */
	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px 16px;
		padding: 8px 12px;
		margin-top: 4px;
		background: rgba(17, 24, 39, 0.5);
		border-top: 1px solid #374151;
		border-radius: 0 0 6px 6px;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #d1d5db;
		cursor: default;
		transition: opacity 0.15s ease;
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
