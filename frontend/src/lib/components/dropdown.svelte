<script>
</script>
<div class="absolute top-0 z-50 w-56 mt-8 right-0 hidden peer-focus:block hover:block">
	<div class="p-1 mt-1 bg-gray-700 border rounded-md shadow-md border-gray-500/70 text-white">
		<div class="px-2 py-1 5 text-sm font-semibold">Environment</div>
		<div class="h-px my-1 -mx-1 bg-gray-500"></div>
		<button class="w-full relative flex flex-row gap-2 cursor-default select-none hover:bg-gray-800 items-center rounded px-2 py-1 5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
<!--			<span><IconTrash /></span>-->
			<slot name="icon"></slot>
			<slot name="title"></slot>
			<slot name="hotkey"></slot>
<!--			<span class="ml-auto text-xs tracking-widest opacity-60">⇧⌘P</span>-->
		</button>
	</div>
</div>
