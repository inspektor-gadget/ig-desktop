<script lang="ts">
	import { getContext } from 'svelte';
	import type { ScaleLinear } from 'd3';
	import type { ChartDimensions } from '$lib/types/charts';

	interface ChartContext {
		dimensions: ChartDimensions;
	}

	interface Props {
		data: Record<string, unknown>[];
		xAccessor: (d: Record<string, unknown>) => number;
		yAccessor: (d: Record<string, unknown>) => number;
		yScale: ScaleLinear<number, number>;
		color?: string;
		barWidth?: number;
	}

	let { data = [], xAccessor, yAccessor, yScale, color = '#3b82f6', barWidth }: Props = $props();

	const chartContext = getContext<ChartContext>('Chart');
	const dimensions = $derived(chartContext.dimensions);

	// Calculate bar width based on data density if not specified
	const calculatedBarWidth = $derived.by(() => {
		if (barWidth) return barWidth;
		if (data.length < 2) return 20;
		// Calculate based on available space and number of data points
		const availableWidth = dimensions.boundedWidth;
		const maxWidth = Math.floor(availableWidth / data.length) - 2;
		return Math.max(2, Math.min(maxWidth, 30));
	});

	// Generate bar rectangles
	const bars = $derived(
		data.map((d) => {
			const x = xAccessor(d);
			const y = yAccessor(d);
			const y0 = yScale(0);
			const height = Math.abs(y0 - y);
			const yPos = y < y0 ? y : y0;

			return {
				x: x - calculatedBarWidth / 2,
				y: yPos,
				width: calculatedBarWidth,
				height
			};
		})
	);
</script>

<g class="bar-series">
	{#each bars as bar, i (i)}
		<rect
			x={bar.x}
			y={bar.y}
			width={bar.width}
			height={bar.height}
			fill={color}
			opacity="0.8"
			rx="1"
			ry="1"
		/>
	{/each}
</g>

<style>
	.bar-series rect {
		transition: all 0.3s ease-out;
	}

	.bar-series rect:hover {
		opacity: 1;
	}
</style>
