<script lang="js">
	let { param, config } = $props();

	import Title from './title.svelte';
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div class="grow">
	<input class="w-full p-1.5 text-sm rounded bg-gray-800" type="text" placeholder="{param.defaultValue}"
				 bind:value={() => { return config.get(param) }, (v) => { config.set(param, v) }}>
</div>
