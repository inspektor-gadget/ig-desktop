<script lang="js">
	let { param } = $props();
</script>

<div class="flex flex-col gap-1">
	<div class="">{param.title || param.key}</div>
	{#if param.description}
		<div
			class="text-xs text-gray-500 whitespace-pre-wrap overflow-ellipsis max-h-24 overflow-hidden mb-2">{param.description}</div>
	{/if}
</div>
