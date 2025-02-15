<script>
	let { children } = $props();
</script>

<div class="flex flex-col flex-1 min-w-0 bg-gray-900">
	{@render children()}
</div>
