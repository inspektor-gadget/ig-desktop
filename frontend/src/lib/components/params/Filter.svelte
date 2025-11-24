<script lang="ts">
	import Title from '$lib/components/params/Title.svelte';
	import { getContext } from 'svelte';
	import Delete from '$lib/icons/fa/trash.svg?raw';
	import Select from '$lib/components/forms/Select.svelte';
	import Input from '$lib/components/forms/Input.svelte';

	const operations = [
		{ key: '==', description: 'equals' },
		{ key: '!=', description: 'not equals' },
		{ key: '<=', description: 'less than or equals' },
		{ key: '>=', description: 'greater than or equals' },
		{ key: '<', description: 'less than' },
		{ key: '>', description: 'greater than' },
		{ key: '~=', description: 'matches regular expression' }
	];

	let currentGadget: any = getContext('currentGadget');

	let fields = $derived.by(() => {
		const gadgetInfo = currentGadget();
		console.log('deriving fields', $state.snapshot(gadgetInfo));
		if (!gadgetInfo) {
			return [];
		}
		let tmpFields: any[] = [];
		Object.values(gadgetInfo.dataSources).forEach((ds: any) => {
			ds.fields.forEach((f: any) => {
				tmpFields.push({ ds: ds.name, ...f });
			});
		});
		return tmpFields;
	});

	let { param, config }: { param: any; config: any } = $props();
	let filters = $state<any[]>([]);

	$effect(() => {
		const res = filters
			.map((f: any) => {
				return `${f.key}${f.op}${f.value?.replace(/\\/g, '\\\\').replace(/,/g, '\\,') || ''}`;
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
				bind:value={filter.key}
				options={fields.map((f) => ({
					value: `${f.ds}:${f.fullName}`,
					label: `${f.ds}:${f.fullName}`
				}))}
				class="text-sm"
			/>
			<Select
				bind:value={filter.op}
				options={operations.map((op) => ({ value: op.key, label: op.key }))}
				class="text-sm"
			/>
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
				filters.push({ key: '', op: '', value: '' });
			}}
		>
			<span>Add Filter</span>
		</button>
	</div>
</div>
