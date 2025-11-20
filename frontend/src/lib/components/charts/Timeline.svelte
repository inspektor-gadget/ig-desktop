<script lang="ts">
	import * as d3 from 'd3';

	import Chart from './Chart/Chart.svelte';
	import Line from './Chart/Line.svelte';
	// import Axis from "./Chart/Axis-naive.svelte";
	import Axis from './Chart/Axis.svelte';
	import Gradient from './Chart/Gradient.svelte';
	import { getUniqueId } from './Chart/utils';

	const formatDate = d3.timeFormat('%x, %X');
	const gradientColors = ['rgb(226, 222, 243)', '#f8f9fa'];
	const gradientId = getUniqueId('Timeline-gradient');

	let { data = [], xAccessor = (d) => d.x, yAccessor = (d) => d.y, label } = $props();

	let width = $state(100);
	let height = $state(100);

	const margins = {
		marginTop: 40,
		marginRight: 30,
		marginBottom: 40,
		marginLeft: 75
	};

	const dms = $derived({
		width,
		height,
		...margins,
		boundedHeight: Math.max(height - margins.marginTop - margins.marginBottom, 0),
		boundedWidth: Math.max(width - margins.marginLeft - margins.marginRight, 0)
	});

	const xScale = $derived(
		d3.scaleTime().domain(d3.extent(data, xAccessor)).range([0, dms.boundedWidth])
	);

	const yScale = $derived(
		d3.scaleLinear().domain(d3.extent(data, yAccessor)).range([dms.boundedHeight, 0]).nice()
	);

	const xAccessorScaled = $derived((d) => xScale(xAccessor(d)));
	const yAccessorScaled = $derived((d) => yScale(yAccessor(d)));
	const y0AccessorScaled = $derived(yScale(yScale.domain()[0]));
</script>

<div class="Timeline placeholder" bind:clientWidth={width} bind:clientHeight={height}>
	<Chart dimensions={dms}>
		<defs>
			<Gradient id={gradientId} colors={gradientColors} x2="0" y2="100%" />
		</defs>
		<Axis dimension="x" scale={xScale} formatTick={formatDate} />
		<Axis dimension="y" scale={yScale} {label} />
		<Line
			type="area"
			{data}
			xAccessor={xAccessorScaled}
			yAccessor={yAccessorScaled}
			y0Accessor={y0AccessorScaled}
			style="fill: url(#{gradientId})"
		/>
		<Line {data} xAccessor={xAccessorScaled} yAccessor={yAccessorScaled} />
	</Chart>
</div>

<style>
	.Timeline {
		height: 300px;
		min-width: 500px;
		width: calc(100% + 1em);
		margin-bottom: 2em;
	}
</style>
