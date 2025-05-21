<script>
	import Info from '$lib/icons/info.svg?raw';
	import Column from '$lib/icons/column.svg?raw';
	import Book from '$lib/icons/book.svg?raw';
	import Bug from '$lib/icons/bug.svg?raw';
	import Layers from '$lib/icons/layers.svg?raw';
	import Adjustments from '$lib/icons/adjustments.svg?raw';
	import Close from '$lib/icons/close.svg?raw';

	import DataSources from './gadget-attribs/datasources.svelte';
	import Params from './gadget-attribs/params.svelte';
	import Metadata from './gadget-attribs/metadata.svelte';
	import GadgetInfo from './gadget-attribs/gadgetinfo.svelte';
	import Inspect from './gadget-attribs/inspect.svelte';
	import ExtraInfo from './gadget-attribs/extrainfo.svelte';

	let {
		gadgetInfo, onclose = () => {
		}
	} = $props();

	const tabs = [
		{ class: DataSources, name: 'Data Sources', icon: Column },
		{ class: Params, name: 'Parameters', icon: Info },
		{ class: Metadata, name: 'Metadata', icon: Book },
		{ class: GadgetInfo, name: 'Gadget Information', icon: Bug },
		{ class: Inspect, name: 'Inspect', icon: Layers },
		{ class: ExtraInfo, name: 'Extra Info', icon: Adjustments }
	];

	let tabIndex = $state(0); // gadget.attribsPage;
	let Component = $derived(tabs[tabIndex].class);
</script>

<div class="flex flex-row bg-gray-950">
	{#each tabs as tab, id}
		<button title={tab.name}
						onclick={() => {
                tabIndex = id }} class={tabIndex === id ?
            "cursor-pointer p-2 bg-gray-900 border-t-gray-500 border-t border-r border-r-gray-700 border-b border-b-transparent" :
            "cursor-pointer p-2 border-t border-t-transparent border-r border-r-gray-700 border-b border-b-gray-700"}>{@html tab.icon}</button>
	{/each}
	<div class="flex-1 border-b border-b-gray-700"></div>
	<button class="cursor-pointer border-b border-b-gray-700 p-2" onclick={onclose}>{@html Close}</button>
</div>

<div class="flex-1 overflow-auto flex flex-col">
	<Component {gadgetInfo} />
</div>
