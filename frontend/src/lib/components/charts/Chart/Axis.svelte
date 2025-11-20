<script lang="ts">
	import { getContext } from 'svelte';
	import * as d3 from 'd3';

	let { dimension = 'x', scale = null, label, formatTick = d3.format(',') } = $props();

	const { dimensions: dimensionsGetter } = getContext('Chart');
	const dimensions = $derived(dimensionsGetter);

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
	<line
		class="Axis__line"
		x2={dimension === 'x' ? dimensions.boundedWidth : 0}
		y2={dimension === 'y' ? dimensions.boundedHeight : 0}
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
		stroke: #bdc3c7;
	}

	.Axis__label {
		text-anchor: middle;
		font-size: 0.8em;
		letter-spacing: 0.01em;
		color: #fff;
	}

	.Axis__tick {
		font-size: 0.9em;
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
