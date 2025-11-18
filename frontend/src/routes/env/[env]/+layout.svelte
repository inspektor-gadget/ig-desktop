<script lang="ts">
	import List from '$lib/icons/list.svg?raw';
	import Delete from '$lib/icons/close-small.svg?raw';
	import Tab from '$lib/components/tab.svelte';
	import { instances } from '$lib/shared/instances.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import { getContext } from 'svelte';

	let { children }: { children: Snippet } = $props();

	let instanceKeys = $derived(
		Object.keys(instances).filter((key) => instances[key].environment === page.params.env)
	);

	const api: any = getContext('api');

	async function closeInstance(instanceID: string) {
		try {
			const res = await api.request({ cmd: 'stopInstance', data: { id: instanceID } });
		} catch (err) {
			// ignore
		}
		console.log('stopped');
		if (page.params.instanceID && page.params.instanceID === instanceID) {
			// Page is currently open, move to env
			goto(`/env/${page.params.env}`);
		}
		delete instances[instanceID];
	}
</script>

<div class="flex min-w-0 flex-1 flex-col bg-gray-900/90">
	<div class="nowrap flex w-full flex-row items-center overscroll-x-auto text-sm text-gray-500">
		<Tab href="/env/{page.params.env}" shrink={true} exact={true}>{@html List}</Tab>
		{#each instanceKeys as instanceKey}
			<Tab href="/env/{page.params.env}/running/{instanceKey}" shrink={false} exact={true}
				><div class="flex flex-row items-center gap-2">
					<button
						class="small-icon rounded-4xl p-0.5 hover:bg-gray-700"
						onclick={(ev) => {
							ev.preventDefault();
							ev.stopPropagation();
							closeInstance(instanceKey);
							return false;
						}}>{@html Delete}</button
					>
					<div>{instances[instanceKey].name || instances[instanceKey].gadgetInfo.imageName}</div>
				</div></Tab
			>
		{/each}
		<div class="h-full flex-grow border-b border-b-gray-700 bg-gray-950"></div>
	</div>
	{@render children()}
</div>
