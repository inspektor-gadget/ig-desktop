<script>
	import List from '$lib/icons/list.svg?raw';
	import Delete from '$lib/icons/close-small.svg?raw';
	import Tab from '$lib/components/tab.svelte';
	import { instances } from '$lib/shared/instances.svelte.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';

	let { children } = $props();

	let instanceKeys = $derived(Object.keys(instances).filter(key => instances[key].environment === page.params.env));

	const api = getContext('api');

	async function closeInstance(instanceID) {
		try {
			const res = await api.request({ cmd: 'stopInstance', data: { id: instanceID } });
		} catch (err) {
			// ignore
		}
		console.log('stopped')
		if (page.params.instanceID && page.params.instanceID === instanceID) {
			// Page is currently open, move to env
			goto(`/env/${page.params.env}`);
		}
		delete(instances[instanceID]);
	}
</script>

<div class="flex flex-col flex-1 min-w-0 bg-gray-900">
	<div class="w-full bg-gray-950 text-sm flex flex-row nowrap overscroll-x-auto text-gray-500 items-center">
		<Tab href="/env/{page.params.env}" shrink={true} exact={true}>{@html List}</Tab>
		{#each instanceKeys as instanceKey}
			<Tab href="/env/{page.params.env}/running/{instanceKey}" shrink={false}
					 exact={true}><div
				class="flex flex-row gap-2 items-center"><button class="small-icon rounded-4xl p-0.5 hover:bg-gray-700"
				onclick={(ev) => { ev.preventDefault(); ev.stopPropagation(); closeInstance(instanceKey); return false; }}>{@html Delete}</button><div>{instances[instanceKey].name ||
			instances[instanceKey].gadgetInfo.imageName}</div></div></Tab>
		{/each}
	</div>
	{@render children()}
</div>

