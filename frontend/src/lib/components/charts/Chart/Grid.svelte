<script lang="ts">
	import { getContext } from 'svelte';
	import type { ChartDimensions } from '$lib/types/charts';
	import type { ScaleTime, ScaleLinear, ScaleBand } from 'd3';

	/** Continuous scales that support .ticks() method */
	type ContinuousScale = ScaleTime<number, number> | ScaleLinear<number, number>;

	interface Props {
		xScale: ContinuousScale | ScaleBand<string>;
		yScale: ScaleLinear<number, number>;
		xTicks?: number;
		yTicks?: number;
	}

	let { xScale, yScale, xTicks = 6, yTicks = 5 }: Props = $props();

	const chartContext = getContext<{ dimensions: ChartDimensions }>('Chart');
	const dimensions = $derived(chartContext.dimensions);

	// Get tick values - handle both continuous and band scales
	const xTickValues = $derived('ticks' in xScale ? xScale.ticks(xTicks) : xScale.domain());
	const yTickValues = $derived(yScale.ticks(yTicks));
</script>

<g class="grid">
	<!-- Horizontal grid lines -->
	{#each yTickValues as tick (tick)}
		<line
			class="grid-line"
			x1={0}
			x2={dimensions.boundedWidth}
			y1={yScale(tick)}
			y2={yScale(tick)}
		/>
	{/each}

	<!-- Vertical grid lines -->
	{#each xTickValues as tick (tick)}
		{@const xPos =
			'ticks' in xScale
				? (xScale as ScaleTime<number, number> | ScaleLinear<number, number>)(tick as number)
				: (xScale as ScaleBand<string>)(tick as string)}
		<line class="grid-line" x1={xPos} x2={xPos} y1={0} y2={dimensions.boundedHeight} />
	{/each}
</g>

<style>
	.grid-line {
		stroke: #374151;
		stroke-width: 1;
		stroke-opacity: 0.5;
	}
</style>
