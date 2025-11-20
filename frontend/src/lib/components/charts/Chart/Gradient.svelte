<script lang="ts">
	let { id = '', x1, x2, y1, y2, colors = [] } = $props();
</script>

<linearGradient {id} {x1} {x2} {y1} {y2} gradientUnits="userSpaceOnUse" spreadMethod="pad">
	{#each colors as color, i}
		<stop offset={`${(i * 100) / (colors.length - 1)}%`} stop-color={color} />
	{/each}
</linearGradient>
