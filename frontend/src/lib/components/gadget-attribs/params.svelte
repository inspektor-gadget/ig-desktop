<script>
	let { gadgetInfo } = $props();
</script>

<h1 class="p-2">Parameters</h1>
<ul class="px-2 mb-2 text-sm">
	{#each gadgetInfo.params as param}
		<li class="border-b border-b-gray-700 py-2 last:border-b-0">
			<div class="">{param.title || param.key}</div>
			{#if param.description}
				<div
					class="text-xs text-gray-500 whitespace-pre-wrap overflow-ellipsis max-h-16 overflow-hidden mb-2">{param.description}</div>
			{/if}
			<div>
				<input class="w-full p-1 rounded bg-gray-800" type="text" placeholder="{param.defaultValue}">
			</div>
		</li>
	{/each}
</ul>
