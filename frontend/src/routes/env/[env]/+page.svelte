<script>
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import { environments } from '$lib/shared/environments.svelte.js';
	import { instances } from '$lib/shared/instances.svelte.js';
	import { goto } from '$app/navigation';

	import Browser from '$lib/icons/fa/browser.svg?raw';
	import CircleSmall from '$lib/icons/fa/circle-small.svg?raw';
	import Trash from '$lib/icons/fa/trash.svg?raw';
	import Close from '$lib/icons/close.svg?raw';
	import Play from '$lib/icons/play.svg?raw';
	import Info from '$lib/icons/fa/info.svg?raw';

	const api = getContext('api');

	let env = $derived(environments[page.params.env]);

	let detachedInstances = $state([]);

	let targetState = $state(0);

	let gadgetURL = $state('');
	let validURL = $derived(gadgetURL !== '');

	$effect(() => {
		if (!env) return;
		detachedInstances = [];
		getList(env.id);
	})

	async function getList(id) {
		targetState = 0;
		try {
			const tmp = await api.request({ cmd: 'listInstances', data: { environmentID: id } });
			console.log('out', tmp);
			detachedInstances = tmp.gadgetInstances;
			targetState = 1;
		} catch (err) {
			targetState = 2;
		}
	}

	async function deleteEnvironment() {
		const res = await api.request({ cmd: 'deleteEnvironment', data: { id: env.id } });
		goto('/')
	}

	async function attachInstance(instance) {
		const res = await api.request({ cmd: 'attachInstance', data: { environmentID: env.id, image: instance.id } });
		console.log('attachInstance', res);
		instances[res.id].name = instance.name; // TODO: hacky workaround; would be better to get this via API
		goto('/env/' + env.id + '/running/' + res.id);
	}

	async function removeInstance(instance) {
		const res = await api.request({ cmd: 'removeInstance', data: { environmentID: env.id, id: instance.id } });
		console.log('removeInstance', res)
		getList(env.id);
	}

	function runInstance() {
		goto('/gadgets/run/' + gadgetURL);
	}
</script>
{#if !env}
	Env not found
{:else}
<div class="flex flex-row overflow-auto">
	<div class="flex flex-col flex-1 min-w-0 bg-gray-900 p-4 gap-4">
		<div class="font-bold flex flex-row items-center justify-between">
			<div class="flex flex-row gap-2 items-center">
				<div class:text-red-800={targetState === 2} class:text-green-600={targetState === 1}
						 class:text-orange-500={targetState === 0}>{@html CircleSmall}</div>
				<div class="text-2xl">{env.name}</div>
			</div>
			<div>
				<button onclick={() => { if (confirm('Do you really want to delete this environment?')) deleteEnvironment() }}
								class="rounded bg-red-900 hover:bg-red-800 text-white px-2 py-1 text-xs font-base cursor-pointer flex flex-row gap-1 items-center"><div>{@html Trash} </div>
					<div>Delete Environment</div></button>
			</div>
		</div>

		{#if env.runtime === 'grpc-ig'}
			<div class="p-4 bg-gray-950 flex flex-row gap-4 rounded">
				<div>Address {env.params['remote-address']}</div>
			</div>
		{:else}
			<div class="p-4 bg-gray-950 flex flex-row gap-4 rounded">
				Kubernetes
			</div>
		{/if}

		<div class="font-bold flex flex-row items-center">
			<span>Run Gadget</span>
		</div>
		<div class="p-4 bg-gray-950 flex flex-row gap-4 rounded">
			<input type="text" bind:value={gadgetURL} class="grow p-1.5 text-sm rounded bg-gray-800"
						 placeholder="gadget image url" />
			<button disabled={!validURL} onclick={runInstance}
							class="flex flex-row gap-1 pl-2 py-2 px-4 rounded cursor-pointer bg-green-800 hover:bg-green-700 disabled:bg-green-950 disabled:text-gray-500 disabled:cursor-not-allowed">
				<span>{@html Play}</span>
				<span>Run Gadget</span>
			</button>
		</div>

		<div class="font-bold flex flex-row items-center gap-2">
			<div>Headless Gadget Instances</div>
			<div><a href="https://inspektor-gadget.io/docs/latest/reference/headless" title="Help"
							target="_blank">{@html Info}</a></div>
		</div>

		<div class="p-4 bg-gray-950 flex flex-col gap-4 rounded overflow-hidden">
			<table class="min-w-full max-w-full w-full">
				<thead class="bg-gray-950 sticky top-0">
				<tr>
					<th class="w-32 font-normal uppercase text-xs text-ellipsis border-r p-2 border-r-gray-600 last:border-r-0">ID
					</th>
					<th class="font-normal uppercase text-xs text-ellipsis border-r p-2 border-r-gray-600 last:border-r-0">Name</th>
					<th class="font-normal uppercase text-xs text-ellipsis border-r p-2 border-r-gray-600 last:border-r-0">Tags</th>
					<th class="font-normal uppercase text-xs text-ellipsis border-r p-2 border-r-gray-600 last:border-r-0">Image</th>
					<th></th>
				</tr>
				</thead>
				<tbody class="text-xs text-gray-400 font-mono">
				{#each detachedInstances as instance}
					<tr>
						<td
							class="text-ellipsis border-r px-2 py-2 border-r-gray-600 last:border-r-0">{instance.id?.substring(0, 12)}</td>
						<td
							class="text-ellipsis border-r px-2 py-2 border-r-gray-600 last:border-r-0">{instance.name}</td>
						<td
							class="text-ellipsis border-r px-2 py-2 border-r-gray-600 last:border-r-0">{instance.tags}</td>
						<td
							class="text-ellipsis border-r px-2 py-2 border-r-gray-600 last:border-r-0">{instance.gadgetConfig?.imageName}</td>
						<td>
							<div class="flex flex-row gap-2 justify-end px-2">
								<button class="cursor-pointer hover:text-white" title="Attach"
												onclick={() => { attachInstance(instance) }}>{@html Browser}</button>
								<button class="cursor-pointer hover:text-white" title="Delete"
												onclick={() => { if (confirm('Do you really want to delete this instance?'))
													removeInstance(instance) }}>{@html
									Trash}</button>
							</div>
						</td>
					</tr>
				{/each}
				</tbody>
			</table>
			{#if detachedInstances.length === 0}
				<div class="text-white text-center text-xs">No running instances found</div>
			{/if}
		</div>
	</div>
<!--	<div class="flex flex-col w-1/4 p-4">-->
<!--		<div class="flex flex-col p-4 bg-gray-950 rounded"></div>-->
<!--	</div>-->
</div>
{/if}
