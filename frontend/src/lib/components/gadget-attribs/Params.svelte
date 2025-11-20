<script lang="ts">
	let { gadgetInfo } = $props();
</script>

<h1 class="p-2">Parameters</h1>
<ul class="mb-2 px-2 text-sm">
	{#each gadgetInfo.params as param}
		<li class="border-b border-b-gray-700 py-2 last:border-b-0">
			<div class="">{param.title || param.key}</div>
			{#if param.description}
				<div
					class="mb-2 max-h-16 overflow-hidden text-xs overflow-ellipsis whitespace-pre-wrap text-gray-500"
				>
					{param.description}
				</div>
			{/if}
			<div>
				<input
					class="w-full rounded bg-gray-800 p-1"
					type="text"
					placeholder={param.defaultValue}
				/>
			</div>
		</li>
	{/each}
</ul>
