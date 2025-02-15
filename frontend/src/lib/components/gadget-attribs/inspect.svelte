<script>
	import { getContext } from 'svelte';

	let gadget = getContext('gadget');

	let inspect = $derived(gadget.inspect);
</script>

<div class="flex-1 text-sm flex">
	{#if inspect}
		<table class="w-full max-w-full border-b border-gray-800">
			<thead class="sticky top-0">
			<tr class="text-xs uppercase bg-gray-950">
				<th class="p-2 font-normal border-r border-gray-800">Key</th>
				<th class="p-2 font-normal">Value</th>
			</tr>
			</thead>
			<tbody>
			{#each inspect.fields as field}
				<tr>
					<td class="px-2 py-1 border-r border-gray-800 text-gray-400">{field.fullName}</td>
					<td class="px-2 py-1 text-nowrap overflow-ellipsis">{inspect.entry[field.fullName]}</td>
				</tr>
			{/each}
			</tbody>
		</table>
	{:else}
		<div class="flex-1 flex items-center justify-center align-middle">
			<div>No node selected.</div>
		</div>
	{/if}
</div>
