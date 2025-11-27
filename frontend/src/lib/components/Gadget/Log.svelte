<script lang="ts">
	import Bug from '$lib/icons/bug.svg?raw';

	let { log } = $props();

	let element: HTMLDivElement;

	$effect(() => {
		if (log) scrollToBottom(element);
	});

	let search = $state('');
	let entries = $derived.by(() => {
		if (!search || !log) return log;
		const lowerSearch = search.toLowerCase();
		return log.filter((e: { msg: string }) => e.msg.toLowerCase().includes(lowerSearch));
	});

	const scrollToBottom = async (node: HTMLDivElement) => {
		node.scroll({ top: node.scrollHeight, behavior: 'smooth' });
	};
</script>

<div class="sticky left-0 flex flex-row justify-between bg-gray-950">
	<div class="flex flex-row p-2">
		<div class="pr-2">{@html Bug}</div>
		<h2 class="flex-122">Log</h2>
	</div>
	<div class="p-2">
		<input class="rounded bg-gray-800 p-1 text-sm" type="text" bind:value={search} />
	</div>
</div>
<div bind:this={element} class="shrink grow overflow-auto bg-gray-900 p-2 font-mono text-xs">
	{#each entries as entry, i (entry.msgID ?? i)}
		<div class="log-severity-{entry.severity}">{entry.msg}</div>
	{/each}
</div>

<style>
	:global {
		.log-severity-trace,
		.log-severity-6 {
			color: var(--color-gray-500);
		}
		.log-severity-debug,
		.log-severity-5 {
			color: var(--color-gray-400);
		}
		.log-severity-info,
		.log-severity-4 {
			color: var(--color-gray-300);
		}
		.log-severity-warning,
		.log-severity-3 {
			color: var(--color-orange-500);
		}
		.log-severity-error,
		.log-severity-2 {
			color: var(--color-red-500);
		}
		.log-severity-fatal,
		.log-severity-1 {
			color: var(--color-red-700);
			background-color: var(--color-white);
		}
		.log-severity-panic,
		.log-severity-0 {
			color: var(--color-white);
			background-color: var(--color-red-700);
		}
	}
</style>
