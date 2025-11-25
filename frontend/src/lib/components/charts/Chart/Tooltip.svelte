<script lang="ts">
	import { getContext } from 'svelte';
	import type { ChartDimensions } from '$lib/types/charts';

	interface TooltipData {
		x: number;
		time: Date;
		values: { label: string; value: number; color: string }[];
	}

	interface Props {
		data: TooltipData | null;
	}

	let { data = null }: Props = $props();

	const chartContext = getContext<{ dimensions: ChartDimensions }>('Chart');
	const dimensions = $derived(chartContext.dimensions);
</script>

{#if data}
	<!-- Vertical line -->
	<line class="tooltip-line" x1={data.x} x2={data.x} y1={0} y2={dimensions.boundedHeight} />

	<!-- Dots on each series -->
	{#each data.values as v (v.label)}
		<circle
			class="tooltip-dot"
			cx={data.x}
			cy={v.value}
			r={4}
			fill={v.color}
			stroke="#1f2937"
			stroke-width={2}
		/>
	{/each}
{/if}

<style>
	.tooltip-line {
		stroke: #6b7280;
		stroke-width: 1;
		stroke-dasharray: 4 2;
		pointer-events: none;
	}

	.tooltip-dot {
		pointer-events: none;
	}
</style>
