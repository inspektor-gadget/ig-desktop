<script lang="ts">
	import * as d3 from 'd3';
	import type { CurveFactory } from 'd3';

	interface Props {
		type?: 'line' | 'area';
		data?: unknown[];
		xAccessor: (d: unknown) => number;
		yAccessor: (d: unknown) => number;
		y0Accessor?: number | ((d: unknown) => number);
		interpolation?: CurveFactory;
		style?: string;
	}

	let {
		type = 'line',
		data = [],
		xAccessor,
		yAccessor,
		y0Accessor = 0,
		interpolation = d3.curveMonotoneX,
		style = ''
	}: Props = $props();

	const lineGenerator = $derived.by(() => {
		const generator =
			type === 'area'
				? d3.area().x(xAccessor).y0(y0Accessor).y1(yAccessor).curve(interpolation)
				: d3.line().x(xAccessor).y(yAccessor).curve(interpolation);
		return generator;
	});

	const line = $derived(lineGenerator(data));
</script>

<path class={`Line Line--type-${type}`} d={line} {style} />

<style>
	.Line {
		transition: all 0.3s ease-out;
	}

	.Line--type-line {
		fill: none;
		stroke: #9980fa;
		stroke-width: 3px;
		stroke-linecap: round;
	}

	.Line--type-area {
		fill: rgba(152, 128, 250, 0.185);
		stroke-width: 0;
	}
</style>
