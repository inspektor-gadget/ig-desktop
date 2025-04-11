<script>
	let { icon = null, children, hotkey = null, onclick = $bindable() } = $props();
</script>

<button class="w-full relative flex flex-row gap-2 cursor-default select-none hover:bg-gray-800 items-center rounded px-2 py-1 5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50" {onclick}>
	{@render icon?.()}
	{@render children?.()}
<!--	<span class="ml-auto text-xs tracking-widest opacity-60">⇧⌘P</span>-->
</button>
