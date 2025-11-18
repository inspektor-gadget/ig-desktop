<script>
	let { children } = $props();
</script>

<div class="flex min-w-0 flex-1 flex-col bg-gray-900">
	{@render children()}
</div>
