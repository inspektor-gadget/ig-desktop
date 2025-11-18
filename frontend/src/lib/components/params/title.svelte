<script lang="js">
	let { param, onclick = $bindable() } = $props();
</script>

<div class="flex flex-col gap-1" {onclick}>
	<div class="">{param.title || param.key}</div>
	{#if param.description}
		<div
			class="mb-2 max-h-24 overflow-hidden text-xs overflow-ellipsis whitespace-pre-wrap text-gray-500"
		>
			{param.description}
		</div>
	{/if}
</div>
