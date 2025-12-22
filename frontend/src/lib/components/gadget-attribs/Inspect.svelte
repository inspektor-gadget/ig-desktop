<script lang="ts">
	import { getContext } from 'svelte';
	import type { GadgetContext } from '$lib/types';

	const gadget = getContext<GadgetContext>('gadget');

	let inspect = $derived(gadget.inspect);
</script>

<div class="flex flex-1 text-sm">
	{#if inspect}
		<table class="w-full max-w-full border-b border-gray-200 dark:border-gray-800">
			<thead class="sticky top-0">
				<tr class="bg-white dark:bg-gray-950 text-xs uppercase">
					<th class="border-r border-gray-200 dark:border-gray-800 p-2 font-normal">Key</th>
					<th class="p-2 font-normal">Value</th>
				</tr>
			</thead>
			<tbody>
				{#each inspect.fields as field}
					<tr>
						<td class="border-r border-gray-200 dark:border-gray-800 px-2 py-1 text-gray-600 dark:text-gray-400">{field.fullName}</td>
						<td class="px-2 py-1 text-nowrap overflow-ellipsis">{inspect.entry[field.fullName]}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<div class="flex flex-1 items-center justify-center align-middle">
			<div>No node selected.</div>
		</div>
	{/if}
</div>
