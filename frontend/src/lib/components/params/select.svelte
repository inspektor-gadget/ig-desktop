<script lang="js">
	let { param, config } = $props();

	import Title from './title.svelte';
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div>
	<div class="grid">
		<svg
			class="pointer-events-none relative right-1 z-10 col-start-1 row-start-1 h-4 w-4 self-center justify-self-end forced-colors:hidden"
			viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path fill-rule="evenodd"
						d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
						clip-rule="evenodd"></path>
		</svg>
		<select class="col-start-1 row-start-1 pl-3 pr-8 appearance-none p-1.5 rounded bg-gray-800"
						bind:value={config.values[param.key]}>
			{#each param.possibleValues as value}
				<option {value}>{value}</option>
			{/each}
		</select>
	</div>
</div>
