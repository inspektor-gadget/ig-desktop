<script lang="ts">
	import Title from '$lib/components/params/Title.svelte';
	import { getContext } from 'svelte';
	import Delete from '$lib/icons/fa/trash.svg?raw';
	import Select from '$lib/components/forms/Select.svelte';
	import Input from '$lib/components/forms/Input.svelte';

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
			<Select
				bind:value={filter.field}
				options={fields.map((f) => ({ value: f.key, label: f.display }))}
				class="text-sm"
			/>
			<div class="flex grow flex-row">
				<Input bind:value={filter.key} placeholder={param.defaultValue} class="text-sm" />
			</div>
			<div class="flex grow flex-row">
				<Input bind:value={filter.value} placeholder={param.defaultValue} class="text-sm" />
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
				filters.push({ field: '', key: '', value: '' });
			}}
		>
			<span>Add Annotation</span>
		</button>
	</div>
</div>
