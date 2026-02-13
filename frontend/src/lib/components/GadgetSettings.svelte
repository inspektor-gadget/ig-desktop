<script lang="ts">
	import type { Component as SvelteComponent } from 'svelte';
	import Server from '$lib/icons/server.svg?raw';
	import Book from '$lib/icons/book.svg?raw';
	import Bug from '$lib/icons/bug.svg?raw';
	import Layers from '$lib/icons/layers.svg?raw';
	import Close from '$lib/icons/close-small.svg?raw';

	import DataSources from './gadget-attribs/DataSources.svelte';
	import Metadata from './gadget-attribs/Metadata.svelte';
	import GadgetInfoComponent from './gadget-attribs/GadgetInfo.svelte';
	import Inspect from './gadget-attribs/Inspect.svelte';
	import type { GadgetInfo } from '$lib/types';
	import { configuration } from '$lib/stores/configuration.svelte';

	let { gadgetInfo, onclose = () => {} }: { gadgetInfo: GadgetInfo; onclose?: () => void } =
		$props();

	// Tab components have varying props - some take gadgetInfo, some use context
	type TabComponent = SvelteComponent<{ gadgetInfo?: GadgetInfo }>;

	const regularTabs: Array<{ class: TabComponent; name: string; icon: string }> = [
		{ class: DataSources as TabComponent, name: 'Data Sources', icon: Server },
		{ class: Inspect as TabComponent, name: 'Inspect', icon: Layers }
	];

	const developerTabs: Array<{ class: TabComponent; name: string; icon: string }> = [
		{ class: Metadata as TabComponent, name: 'Gadget Metadata', icon: Book },
		{ class: GadgetInfoComponent as TabComponent, name: 'GadgetInfo', icon: Bug }
	];

	const developerMode = $derived(configuration.get('developerMode') === true);
	const tabs = $derived(developerMode ? [...regularTabs, ...developerTabs] : regularTabs);

	let tabIndex = $state(0);

	// Reset tab index if it's out of bounds (e.g., when developer mode is disabled)
	$effect(() => {
		if (tabIndex >= tabs.length) {
			tabIndex = 0;
		}
	});

	let Component = $derived(tabs[tabIndex]?.class);
</script>

<div class="flex flex-row bg-ig-surface">
	{#each tabs as tab, id}
		<button
			title={tab.name}
			onclick={() => {
				tabIndex = id;
			}}
			class={tabIndex === id
				? 'cursor-pointer border-t border-r border-b border-t-ig-text-muted border-r-ig-border border-b-transparent bg-ig-surface-raised p-2'
				: 'cursor-pointer border-t border-r border-b border-t-transparent border-r-ig-border border-b-ig-border p-2'}
			>{@html tab.icon}</button
		>
	{/each}
	<div class="flex-1 border-b border-b-ig-border"></div>
	<button
		class="flex cursor-pointer items-center justify-center border-b border-b-ig-border px-3 text-ig-text-muted transition-colors hover:text-ig-text-secondary"
		onclick={onclose}
		title="Close Inspector"
	>
		<span class="rounded-ig-sm p-1 transition-colors hover:bg-ig-border"
			>{@html Close}</span
		>
	</button>
</div>

<div class="flex flex-1 flex-col overflow-auto bg-ig-surface-raised">
	<Component {gadgetInfo} />
</div>
