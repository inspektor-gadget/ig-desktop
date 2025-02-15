<script lang="js">
	let { param, config } = $props();

	import Title from './title.svelte';
</script>

<div class="flex flex-row gap-4">
	<div><input type="checkbox" class="rounded border border-gray-300"
							bind:checked={() => { return config.get(param)	=== 'true' }, (v) => { config.set(param, ''+v)	}} />
	</div>
	<Title {param} />
</div>
