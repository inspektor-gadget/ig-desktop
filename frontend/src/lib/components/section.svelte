<script>
	import Info from '$lib/icons/fa/info.svg?raw';

	let { icon = null, info = null, children, title } = $props();
</script>
<div class="flex flex-col gap-2">
	{#if title}
		<div class="flex flex-row items-center gap-2">
			<div class="flex flex-row gap-2 items-center">
				<div>{@render icon?.()}</div>
				<div>{title}</div>
			</div>
			{#if info}
				<div><a href="https://inspektor-gadget.io/docs/latest/reference/headless" title="Help" target="_blank">{@html Info}</a></div>
			{/if}
		</div>
	{/if}
	<div class="p-2 bg-gray-950 flex flex-col gap-4 rounded overflow-hidden">
		{@render children?.()}
	</div>
</div>
