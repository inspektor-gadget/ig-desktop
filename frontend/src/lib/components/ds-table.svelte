<script>
	import Table from '$lib/icons/table-column.svg?raw';
	import Dots from '$lib/icons/dots-vertical.svg?raw';
	import { getContext } from 'svelte';
	import { environments } from '$lib/shared/environments.svelte.js';
	import { page } from '$app/state';

	let { ds, events } = $props();

	function visible(flags) {
		if (!flags) return true;
		// if ((flags & 0x0004) !== 0) return false; // hidden
		if ((flags & 0x0002) !== 0) return false; // container
		if ((flags & 0x0001) !== 0) return false; // empty
		return true;
	}

	const gadget = getContext('gadget');

	let env = $derived(environments[page.params.env]);

	const visibleFields = $derived(ds.fields.filter((field) => {
		if (env.runtime === 'grpc-ig') {
			if (field.tags?.indexOf('kubernetes') >= 0) return false;
		}
		if (field.annotations['columns.hidden'] === 'true') {
			return false;
		}
		return visible(field.flags);
	}).sort((a, b) => {	return (a.order || 0) - (b.order || 0) }));

	function inspect(data) {
		const snapshot = { fields: $state.snapshot(ds.fields), entry: $state.snapshot(data) };
		gadget.inspect = snapshot;
		console.log(snapshot);
	}
</script>

<div class="flex flex-col overflow-x-auto overscroll-none h-full border-t-1 border-gray-500">
	<div
		class="sticky left-0 top-0 h-10 p-2 flex flex-row bg-gray-950 items-center text-base font-normal">
		<div class="pr-2">{@html Table}</div>
		<h2 class="px-2">{ds.name}</h2>
		<div class="flex-1"></div>
		<button class="pl-2">{@html Dots}</button>
	</div>

	<div class="flex-col md:block scrollbar-hide text-sm border-b border-b-gray-950">
		<table class="min-w-full">
			<thead class="bg-gray-950 sticky top-10">
			<tr>
				{#each visibleFields as field}
					<th
						class="font-normal text-xs text-ellipsis border-r p-2 border-r-gray-600 last:border-r-0">
						<div class="flex flex-col">
							<div class="flex flex-row items-center justify-between">
								<div title={field.annotations?.description} class="uppercase">{field.fullName}</div>
							</div>
						</div>
					</th>
				{/each}
			</tr>
			</thead>
			<tbody class="text-xs text-gray-400 font-mono">
			{#each events as entry (entry.msgID)}
				<tr class="hover:bg-gray-800 cursor-pointer" onclick={() => {
                    inspect(entry)
                    // gadget.inspect.set({ fields: gadget.dataSources[ds.id || 0].mapping, entry });
                    // gadget.showAttribs.set(true);
                    // gadget.attribsPage.set(4);
                }}>
					{#each visibleFields as field}
						<td
							class="text-nowrap text-ellipsis border-r px-2 py-0 border-r-gray-600 last:border-r-0"
							class:text-right={['Uint64', 'Uint32', 'Uint16', 'Int64', 'Int32', 'Int16'].indexOf(field.kind) >= 0}
						>{entry[field.fullName]}</td>
					{/each}
				</tr>
			{/each}
			</tbody>
		</table>
	</div>
</div>
