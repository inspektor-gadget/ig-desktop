<script>
	let { children, title = null } = $props();
</script>
<div class="absolute top-0 z-50 w-56 mt-8 right-0 hidden peer-focus:block hover:block">
	<div class="p-1 mt-1 bg-gray-700 border rounded-md shadow-md border-gray-500/70 text-white">
		{#if title}
			<div class="px-2 py-1 5 text-sm font-semibold">{title}</div>
			<div class="h-px my-1 -mx-1 bg-gray-500"></div>
		{/if}
		{@render children?.()}
	</div>
</div>
