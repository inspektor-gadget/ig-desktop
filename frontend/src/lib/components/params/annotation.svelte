<script lang="js">
	import Title from '$lib/components/params/title.svelte';
	import { getContext } from 'svelte';
	import Delete from '$lib/icons/fa/trash.svg?raw';

	let currentGadget = getContext('currentGadget');

	let fields = $derived.by(() => {
		const gadgetInfo = currentGadget();
		if (!gadgetInfo) {
			return [];
		}
		let tmpFields = [];
		Object.values(gadgetInfo.dataSources).forEach((ds) => {
			tmpFields.push({ key: ds.name, display: ds.name });
			ds.fields.forEach(f => {
				tmpFields.push({ key: ds.name + '.' + f.fullName, display: '- ' + ds.name + '.' + f.fullName });
			})
		});
		return tmpFields;
	})

	let { param, config } = $props();
	let filters = $state([]);


	$effect(() => {
		const res = filters.map(f => {
			return `${f.field}:${f.key || ''}=${f.value?.replace(/\\/g, '\\\\').replace(/,/g, '\\,') || ''}`;
		}).join(',');
		if (!res.length) {
			delete(config.values[param.key]);
		} else {
			config.set(param, res);
		}
	});
</script>


<div class="w-1/3">
	<Title {param} />
</div>
<div class="flex flex-col gap-1">
	{#each filters as filter, idx}
		<div class="flex flex-row items-start gap-2 items-stretch">
			<div class="grid">
				<svg
					class="pointer-events-none relative right-1 z-10 col-start-1 row-start-1 h-4 w-4 self-center justify-self-end forced-colors:hidden"
					viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path fill-rule="evenodd"
								d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
								clip-rule="evenodd"></path>
				</svg>
				<select class="col-start-1 row-start-1 pl-3 pr-8 appearance-none p-1.5 rounded bg-gray-800"
								bind:value={filter.field}>
					{#each fields as field}
						<option value={field.key}>{field.display}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-row grow">
				<input class="w-full p-1.5 text-sm rounded bg-gray-800" type="text" placeholder="{param.defaultValue}"
							 bind:value={filter.key}>
			</div>
			<div class="flex flex-row grow">
				<input class="w-full p-1.5 text-sm rounded bg-gray-800" type="text" placeholder="{param.defaultValue}"
							 bind:value={filter.value}>
			</div>
			<button class="flex flex-row gap-2 py-1 px-2 rounded cursor-pointer bg-red-900 hover:bg-red-800 items-center"
							onclick={() => { filters.splice(idx, 1); }}>
				<span>{@html Delete}</span>
			</button>
		</div>
	{/each}
	<div>
		<button class="flex flex-row gap-2 py-1 px-2 rounded cursor-pointer bg-gray-800 hover:bg-gray-700 items-center"
						onclick={() => { filters.push({}); }}>
			<span>Add Annotation</span>
		</button>
	</div>
</div>
