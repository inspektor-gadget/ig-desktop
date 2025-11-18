<script lang="ts">
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
			ds.fields.forEach((f) => {
				tmpFields.push({
					key: ds.name + '.' + f.fullName,
					display: '- ' + ds.name + '.' + f.fullName
				});
			});
		});
		return tmpFields;
	});

	let { param, config } = $props();
	let filters = $state([]);

	$effect(() => {
		const res = filters
			.map((f) => {
				return `${f.field}:${f.key || ''}=${f.value?.replace(/\\/g, '\\\\').replace(/,/g, '\\,') || ''}`;
			})
			.join(',');
		if (!filters.length) {
			config.set(param, undefined);
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
		<div class="flex flex-row items-start items-stretch gap-1">
			<div class="grid">
				<svg
					class="pointer-events-none relative right-1 z-10 col-start-1 row-start-1 h-4 w-4 self-center justify-self-end forced-colors:hidden"
					viewBox="0 0 16 16"
					fill="currentColor"
					aria-hidden="true"
				>
					<path
						fill-rule="evenodd"
						d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
						clip-rule="evenodd"
					></path>
				</svg>
				<select
					class="col-start-1 row-start-1 appearance-none rounded bg-gray-800 p-1.5 pr-8 pl-3"
					bind:value={filter.field}
				>
					{#each fields as field}
						<option value={field.key}>{field.display}</option>
					{/each}
				</select>
			</div>
			<div class="flex grow flex-row">
				<input
					class="w-full rounded bg-gray-800 p-1.5 text-sm"
					type="text"
					placeholder={param.defaultValue}
					bind:value={filter.key}
				/>
			</div>
			<div class="flex grow flex-row">
				<input
					class="w-full rounded bg-gray-800 p-1.5 text-sm"
					type="text"
					placeholder={param.defaultValue}
					bind:value={filter.value}
				/>
			</div>
			<button
				class="flex cursor-pointer flex-row items-center gap-2 rounded bg-red-900 px-2 py-1 hover:bg-red-800"
				onclick={() => {
					filters.splice(idx, 1);
				}}
			>
				<span>{@html Delete}</span>
			</button>
		</div>
	{/each}
	<div>
		<button
			class="flex cursor-pointer flex-row items-center gap-2 rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
			onclick={() => {
				filters.push({});
			}}
		>
			<span>Add Annotation</span>
		</button>
	</div>
</div>
