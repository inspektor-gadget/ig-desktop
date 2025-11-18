<script lang="js">
	let { param, config } = $props();

	import Title from './title.svelte';

	let value = $state(config.get(param));

	$effect(() => {
		config.set(param, value);
	});
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div class="grow">
	<input
		type="number"
		class="rounded bg-gray-800 p-1.5"
		placeholder={param.defaultValue}
		bind:value
	/>
</div>
