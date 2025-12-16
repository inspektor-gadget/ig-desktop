<script lang="ts">
	import List from '$lib/icons/list.svg?raw';
	import Delete from '$lib/icons/close-small.svg?raw';
	import Tab from '$lib/components/Tab.svelte';
	import { instances } from '$lib/shared/instances.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import { getContext } from 'svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	let { children }: { children: Snippet } = $props();

	let instanceKeys = $derived(
		Object.keys(instances).filter((key) => instances[key].environment === page.params.env)
	);

	const api: any = getContext('api');

	async function closeInstance(instanceID: string) {
		const instance = instances[instanceID];
		const instanceName =
			instance?.name || instance?.gadgetInfo?.imageName || instanceID.substring(0, 8);
		const isAttached = instance?.attached;
		const wasRunning = instance?.running;

		try {
			const res = await api.request({ cmd: 'stopInstance', data: { id: instanceID } });
			console.log('stopped');

			// Only show toast if we actually stopped/detached (was still running)
			if (wasRunning) {
				if (isAttached) {
					toastStore.success(`Detached from "${instanceName}" successfully`);
				} else {
					toastStore.success(`Instance "${instanceName}" stopped successfully`);
				}
			}

			if (page.params.instanceID && page.params.instanceID === instanceID) {
				// Page is currently open, move to env
				goto(resolve(`/env/${page.params.env}`));
			}
			delete instances[instanceID];
		} catch (err: any) {
			// Show error toast
			const errorMessage = err?.message || err?.toString() || 'Unknown error';
			const action = isAttached ? 'detach from' : 'stop';
			toastStore.error(`Failed to ${action} instance "${instanceName}": ${errorMessage}`, 7000, {
				label: 'Retry',
				onClick: () => closeInstance(instanceID)
			});
		}
	}
</script>

<div class="flex min-w-0 flex-1 flex-col bg-gray-50/90 dark:bg-gray-900/90">
	<div class="nowrap flex w-full flex-row items-center overscroll-x-auto text-sm text-gray-600 dark:text-gray-500">
		<Tab href={resolve(`/env/${page.params.env}`)} shrink={true} exact={true}>{@html List}</Tab>
		{#each instanceKeys as instanceKey}
			<Tab href={resolve(`/env/${page.params.env}/running/${instanceKey}`)} shrink={false} exact={true}
				><div class="flex flex-row items-center gap-2">
					<button
						class="small-icon rounded-4xl p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700"
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
		<div class="h-full flex-grow border-b border-b-gray-300 dark:border-b-gray-700 bg-white dark:bg-gray-950"></div>
	</div>
	{@render children()}
</div>
