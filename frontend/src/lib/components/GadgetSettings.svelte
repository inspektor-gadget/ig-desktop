<script lang="ts">
	import Info from '$lib/icons/info.svg?raw';
	import Column from '$lib/icons/column.svg?raw';
	import Book from '$lib/icons/book.svg?raw';
	import Bug from '$lib/icons/bug.svg?raw';
	import Layers from '$lib/icons/layers.svg?raw';
	import Close from '$lib/icons/close.svg?raw';

	import DataSources from './gadget-attribs/Datasources.svelte';
	import Params from './gadget-attribs/Params.svelte';
	import Metadata from './gadget-attribs/Metadata.svelte';
	import GadgetInfo from './gadget-attribs/GadgetInfo.svelte';
	import Inspect from './gadget-attribs/Inspect.svelte';

	let { gadgetInfo, onclose = () => {} }: { gadgetInfo: any; onclose?: () => void } = $props();

	const tabs = [
		{ class: DataSources, name: 'Data Sources', icon: Column },
		{ class: Params, name: 'Parameters', icon: Info },
		{ class: Metadata, name: 'Metadata', icon: Book },
		{ class: GadgetInfo, name: 'Gadget Information', icon: Bug },
		{ class: Inspect, name: 'Inspect', icon: Layers }
		// { class: Inspect, name: 'Inspect', icon: Adjustments }
	];

	let tabIndex = $state(0); // gadget.attribsPage;
	let Component = $derived(tabs[tabIndex].class);
</script>

<div class="flex flex-row bg-gray-950">
	{#each tabs as tab, id}
		<button
			title={tab.name}
			onclick={() => {
				tabIndex = id;
			}}
			class={tabIndex === id
				? 'cursor-pointer border-t border-r border-b border-t-gray-500 border-r-gray-700 border-b-transparent bg-gray-900 p-2'
				: 'cursor-pointer border-t border-r border-b border-t-transparent border-r-gray-700 border-b-gray-700 p-2'}
			>{@html tab.icon}</button
		>
	{/each}
	<div class="flex-1 border-b border-b-gray-700"></div>
	<button class="cursor-pointer border-b border-b-gray-700 p-2" onclick={onclose}
		>{@html Close}</button
	>
</div>

<div class="flex flex-1 flex-col overflow-auto bg-gray-900">
	<Component {gadgetInfo} />
</div>
