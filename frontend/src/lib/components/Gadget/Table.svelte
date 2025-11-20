<script lang="ts">
	import Table from '$lib/icons/table-column.svg?raw';
	import Dots from '$lib/icons/dots-vertical.svg?raw';
	import { getContext } from 'svelte';
	import { environments } from '$lib/shared/environments.svelte';
	import { page } from '$app/state';

	let { ds, events }: { ds: any; events: any } = $props();

	/** @param {number | undefined} flags */
	function visible(flags) {
		if (!flags) return true;
		// if ((flags & 0x0004) !== 0) return false; // hidden
		if ((flags & 0x0002) !== 0) return false; // container
		if ((flags & 0x0001) !== 0) return false; // empty
		return true;
	}

	const gadget = getContext('gadget');

	let env = $derived(environments[page.params.env || '']);

	const visibleFields = $derived(
		ds.fields
			.filter(
				/** @param {any} field */
				(field) => {
					if (env.runtime === 'grpc-ig') {
						if (field.tags?.indexOf('kubernetes') >= 0) return false;
					}
					if (field.annotations['columns.hidden'] === 'true') {
						return false;
					}
					return visible(field.flags);
				}
			)
			.sort(
				/**
				 * @param {any} a
				 * @param {any} b
				 */
				(a, b) => {
					return (a.order || 0) - (b.order || 0);
				}
			)
	);

	/** @param {any} data */
	function inspect(data) {
		const snapshot = { fields: $state.snapshot(ds.fields), entry: $state.snapshot(data) };
		gadget.inspect = snapshot;
		console.log(snapshot);
	}
</script>

<div class="flex h-full flex-col overflow-x-auto overscroll-none border-t-1 border-gray-500">
	<div
		class="sticky top-0 left-0 flex h-10 flex-row items-center bg-gray-950 p-2 text-base font-normal"
	>
		<div class="pr-2">{@html Table}</div>
		<h2 class="px-2">{ds.name}</h2>
		<div class="flex-1"></div>
		<button class="pl-2">{@html Dots}</button>
	</div>

	<div class="scrollbar-hide flex-col border-b border-b-gray-950 text-sm md:block">
		<table class="min-w-full">
			<thead class="sticky top-10 bg-gray-950">
				<tr>
					{#each visibleFields as field}
						<th
							class="border-r border-r-gray-600 p-2 text-xs font-normal text-ellipsis last:border-r-0"
						>
							<div class="flex flex-col">
								<div class="flex flex-row items-center justify-between">
									<div title={field.annotations?.description} class="uppercase">
										{field.fullName}
									</div>
								</div>
							</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody class="font-mono text-xs text-gray-200">
				{#each events as entry (entry.msgID)}
					<tr
						class="cursor-pointer hover:bg-gray-800"
						onclick={() => {
							inspect(entry);
							// gadget.inspect.set({ fields: gadget.dataSources[ds.id || 0].mapping, entry });
							// gadget.showAttribs.set(true);
							// gadget.attribsPage.set(4);
						}}
					>
						{#each visibleFields as field}
							<td
								class="border-r border-r-gray-600 px-2 py-0 text-nowrap text-ellipsis last:border-r-0"
								class:text-right={['Uint64', 'Uint32', 'Uint16', 'Int64', 'Int32', 'Int16'].indexOf(
									field.kind
								) >= 0}>{entry[field.fullName]}</td
							>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
