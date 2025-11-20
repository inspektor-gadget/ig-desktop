<script lang="ts">
	import { setContext } from 'svelte';

	let { dimensions = {} } = $props();

	let currentDimensions = $state(dimensions);

	$effect(() => {
		currentDimensions = dimensions;
	});

	setContext('Chart', {
		get dimensions() {
			return currentDimensions;
		}
	});

	let { children } = $props();
</script>

<svg class="Chart" width={dimensions.width} height={dimensions.height}>
	<g transform={`translate(${dimensions.marginLeft}, ${dimensions.marginTop})`}>
		{@render children()}
	</g>
</svg>
