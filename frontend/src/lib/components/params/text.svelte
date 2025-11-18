<script lang="js">
	let { param, config } = $props();

	let isMultiline = $derived(param.tags?.find((tag) => tag === 'multiline'));

	import Title from './title.svelte';
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div class="grow">
	{#if isMultiline}
		<textarea
			rows="4"
			class="w-full rounded bg-gray-800 p-1.5 text-sm"
			type="text"
			placeholder={param.defaultValue}
			bind:value={
				() => {
					return config.get(param);
				},
				(v) => {
					config.set(param, v);
				}
			}
		></textarea>
	{:else}
		<input
			class="w-full rounded bg-gray-800 p-1.5 text-sm"
			type="text"
			placeholder={param.defaultValue}
			bind:value={
				() => {
					return config.get(param);
				},
				(v) => {
					config.set(param, v);
				}
			}
		/>
	{/if}
</div>
