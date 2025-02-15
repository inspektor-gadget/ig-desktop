<script lang="js">
	let { param, config } = $props();

	import Title from './title.svelte';
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div class="grow">
	<input type="number" class="p-1.5 rounded bg-gray-800" placeholder="{param.defaultValue}"
				 bind:value={() => { return config.get(param) }, (v) => { config.set(param, v) }}>
</div>
