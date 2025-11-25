<script lang="ts">
	import { getContext } from 'svelte';
	import * as d3 from 'd3';
	import type { ChartDimensions } from '$lib/types/charts';

	let { dimension = 'x', scale = null, label, formatTick = d3.format(',') } = $props();

	const chartContext = getContext<{ dimensions: ChartDimensions }>('Chart');
	const dimensions = $derived(chartContext.dimensions);

	const numberOfTicks = $derived(
		dimension === 'x'
			? dimensions.boundedWidth < 600
				? dimensions.boundedWidth / 100
				: dimensions.boundedWidth / 250
			: dimensions.boundedHeight / 70
	);

	const ticks = $derived(scale.ticks(numberOfTicks));
</script>

<g
	class="Axis Axis--dimension-{dimension}"
	transform={`translate(0, ${dimension === 'x' ? dimensions.boundedHeight : 0})`}
>
	<!-- Axis line -->
	<line
		class="Axis__line"
		x1={dimension === 'x' ? 0 : 0}
		x2={dimension === 'x' ? dimensions.boundedWidth : 0}
		y1={dimension === 'x' ? 0 : 0}
		y2={dimension === 'x' ? 0 : dimensions.boundedHeight}
	/>

	{#each ticks as tick, i}
		<text
			class="Axis__tick"
			transform={`translate(${(dimension === 'x' ? [scale(tick), 25] : [-16, scale(tick)]).join(
				', '
			)})`}
		>
			{formatTick(tick)}
		</text>
	{/each}

	{#if label}
		<text
			class="Axis__label"
			style="transform: translate({(dimension === 'x'
				? [dimensions.boundedWidth / 2, 60]
				: [-56, dimensions.boundedHeight / 2]
			)
				.map((d) => d + 'px')
				.join(', ')}) {dimension === 'y' ? 'rotate(-90deg)' : ''}"
		>
			{label}
		</text>
	{/if}
</g>

<style>
	.Axis__line {
		stroke: #3f3f46; /* gray-700 */
		stroke-width: 1;
	}

	.Axis__label {
		text-anchor: middle;
		font-size: 0.8em;
		letter-spacing: 0.01em;
		fill: #9ca3af; /* gray-400 */
	}

	.Axis__tick {
		font-size: 0.75em;
		fill: #6b7280; /* gray-500 */
		transition: all 0.3s ease-out;
	}

	.Axis--dimension-x .Axis__tick {
		text-anchor: middle;
	}

	.Axis--dimension-y .Axis__tick {
		dominant-baseline: middle;
		text-anchor: end;
	}
</style>
