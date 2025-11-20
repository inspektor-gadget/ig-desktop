<script lang="ts">
	import * as d3 from 'd3';

	let {
		type = 'line',
		data = [],
		xAccessor = () => {},
		yAccessor = () => {},
		y0Accessor = 0,
		interpolation = d3.curveMonotoneX,
		style = ''
	} = $props();

	const lineGenerator = $derived.by(() => {
		const generator = d3[type]().x(xAccessor).y(yAccessor).curve(interpolation);
		if (type === 'area') {
			generator.y0(y0Accessor).y1(yAccessor);
		}
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
