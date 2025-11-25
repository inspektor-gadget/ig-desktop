<script lang="ts">
	interface Props {
		id?: string;
		x1: number | string;
		x2: number | string;
		y1: number | string;
		y2: number | string;
		colors?: string[];
	}

	let { id = '', x1, x2, y1, y2, colors = [] }: Props = $props();

	/** Calculate stop offset, handling single-color edge case */
	function getOffset(index: number, total: number): string {
		if (total <= 1) return '0%';
		return `${(index * 100) / (total - 1)}%`;
	}
</script>

<linearGradient {id} {x1} {x2} {y1} {y2} gradientUnits="userSpaceOnUse" spreadMethod="pad">
	{#each colors as color, i}
		<stop offset={getOffset(i, colors.length)} stop-color={color} />
	{/each}
</linearGradient>
