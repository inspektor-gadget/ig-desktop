<script>
	import Bug from '$lib/icons/bug.svg?raw';

	let { log } = $props();

	let element;

	$effect(() => {
		if (log) scrollToBottom(element);
	});

	// $: if (log && element) {
	//     scrollToBottom(element);
	// }

	const scrollToBottom = async (node) => {
		node.scroll({ top: node.scrollHeight, behavior: 'smooth' });
	};
</script>

<div class="sticky left-0 p-2 flex flex-row bg-gray-950">
	<div class="pr-2">{@html Bug}</div>
	<h2 class="flex-122">Log</h2>
</div>
<div bind:this={element} class="grow shrink p-2 bg-gray-950 text-xs font-mono overflow-auto">
	{#each log as entry (entry.msgID)}
		<div>{entry.msg}</div>
	{/each}
</div>
