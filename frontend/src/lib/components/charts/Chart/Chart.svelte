<script lang="ts">
	import { setContext, type Snippet } from 'svelte';
	import type { ChartDimensions } from '$lib/types/charts';

	interface Props {
		dimensions: ChartDimensions;
		children: Snippet;
	}

	let { dimensions, children }: Props = $props();

	// Use getter to provide reactive access to dimensions from context
	setContext('Chart', {
		get dimensions() {
			return dimensions;
		}
	});
</script>

<svg class="Chart" width={dimensions.width} height={dimensions.height}>
	<g transform={`translate(${dimensions.marginLeft}, ${dimensions.marginTop})`}>
		{@render children()}
	</g>
</svg>
