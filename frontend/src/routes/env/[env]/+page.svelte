<script>
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import { environments } from '$lib/shared/environments.svelte.js';
	import { instances } from '$lib/shared/instances.svelte.js';
	import { goto } from '$app/navigation';

	import Section from '$lib/components/section.svelte';

	import Browser from '$lib/icons/fa/browser.svg?raw';
	import CircleSmall from '$lib/icons/fa/circle-small.svg?raw';
	import Trash from '$lib/icons/fa/trash.svg?raw';
	import PlaySmall from '$lib/icons/fa/play.svg?raw';
	import Lock from '$lib/icons/fa/lock.svg?raw';
	import LockOpen from '$lib/icons/fa/lock-open.svg?raw';
	import History from '$lib/icons/fa/clock-rotate-left.svg?raw';
	import Info from '$lib/icons/fa/info.svg?raw';
	import Server from '$lib/icons/fa/server.svg?raw';
	import { preferences } from '$lib/shared/preferences.svelte.js';
	import Deploy from '$lib/components/deploy.svelte';
	import DotsVertical from '$lib/icons/dots-vertical.svg?raw';
	import PenToSquare from '$lib/icons/fa/light/pen-to-square.svelte';
	import IconTrash from '$lib/icons/fa/light/trash.svelte';
	import { Dropdown, DropdownItem } from '$lib/components/Dropdown';
	import Icon from '$lib/components/icon.svelte';

	const api = getContext('api');

	let env = $derived(environments[page.params.env]);

	let detachedInstances = $state([]);

	let targetState = $state(0);

	let gadgetURL = $state('');
	let validURL = $derived(gadgetURL !== '');

	let deploymentStatus = $state(false);

	// for grpc-k8s, we also require a valid deploymentStatus
	let ready = $derived(env.runtime !== 'grpc-k8s' || deploymentStatus);

	$effect(() => {
		if (!env) return;
		detachedInstances = [];
		deploymentStatus = false;
		getList(env.id);
		getDeploymentStatus(env);
	})

	async function getDeploymentStatus(env) {
		if (env.runtime !== 'grpc-k8s') {
			return;
		}
		const tmp = await api.request({ cmd: 'getDeploymentStatus', data: { environmentID: env.id } });
		console.log(tmp);
		deploymentStatus = tmp.found;
	}

	let history = $derived(preferences.get('gadget-history') || [])

	async function getList(id) {
		targetState = 0;
		try {
			const tmp = await api.request({ cmd: 'listInstances', data: { environmentID: id } });
			detachedInstances = tmp.gadgetInstances || []; // TODO: check why this can return empty
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
		try {
			const res = await api.request({ cmd: 'attachInstance', data: { environmentID: env.id, image: instance.id } });
			console.log('attachInstance', res);
			instances[res.id].name = instance.name; // TODO: hacky workaround; would be better to get this via API
			goto('/env/' + env.id + '/running/' + res.id);
		} catch (err) {
			console.log('error attaching to gadget', err);
		}
	}

	async function removeInstance(instance) {
		const res = await api.request({ cmd: 'removeInstance', data: { environmentID: env.id, id: instance.id } });
		console.log('removeInstance', res)
		getList(env.id);
	}

	function runInstance() {
		goto('/gadgets/run/' + gadgetURL + '?environmentID=' + env.id);
	}

	async function runGadget(gadgetRunRequest) {
		try {
			const res = await api.request({ cmd: 'runGadget', data: { ...gadgetRunRequest, environmentID: env.id }});
			if (gadgetRunRequest.detached) {
				getList(env.id);
			} else {
				goto('/env/' + env.id + '/running/' + res.id);
			}
		} catch (err) {
			console.log('error running gadget', err);
		}
	}
</script>
{#if !env}
	Env not found
{:else if !ready}
	<Deploy environmentID={env.id} />
{:else}
<div class="flex flex-col overflow-auto">
	<div class="flex flex-col flex-1 min-w-0 bg-gray-900 p-4 gap-4">
		<div class="flex flex-row items-center justify-between">
			<div class="flex flex-row gap-4 items-center">
				<div class="flex flex-col gap-0.5">
					<div class="flex flex-row items-center gap-1">
						<div class="text-2xl font-bold">{env.name}</div>
						<div class:text-red-800={targetState === 2} class:text-green-600={targetState === 1}
								 class:text-orange-500={targetState === 0}>{@html CircleSmall}</div>
					</div>
					<div class="text-xs flex flex-row gap-1 text-gray-400 items-center">
						{#if env.runtime === 'grpc-ig'}
							{#if env.params && env.params['tls-key-file']}
								<div class="text-green-300" title="Secure Connection">{@html Lock}</div>
							{:else}
								<div class="text-red-300" title="Insecure Connection">{@html LockOpen}</div>
							{/if}
							<div>{env.params['remote-address']}</div>
						{:else}
							<div class="text-xs flex flex-row gap-4 rounded">
								Kubernetes
							</div>
						{/if}
					</div>
				</div>
			</div>
			<div>{deploymentStatus}</div>
			<div class="relative">
<!--				<button onclick={() => { if (confirm('Do you really want to delete this environment?')) deleteEnvironment() }}-->
<!--								class="rounded bg-red-900 hover:bg-red-800 text-white px-2 py-1 text-sm font-base cursor-pointer flex flex-row gap-1 items-center">-->
<!--					<span>{@html Trash} </span>-->
<!--					<span>Delete Environment</span>-->
<!--				</button>-->
				<button class="p-1 hover:bg-gray-700 rounded peer" tabindex="0">{@html DotsVertical}</button>
				<Dropdown>
					<DropdownItem icon={IconTrash} onclick={() => { goto('/env/' + page.params.env + '/config') }}>Edit</DropdownItem>
					<DropdownItem icon={IconTrash} onclick={() => { if (confirm('Do you really want to delete this environment?')) deleteEnvironment() }}>Delete</DropdownItem>
				</Dropdown>
			</div>
		</div>

		<div class="flex flex-col gap-2">
			<div class="flex flex-row gap-2 items-center">
				<div>{@html PlaySmall}</div>
				<div>Run Gadget</div>
			</div>
			<div class="flex flex-col p-2 bg-gray-950 rounded gap-4">
				<div class="flex flex-row gap-2">
					<input type="text" bind:value={gadgetURL} class="grow p-1.5 text-sm rounded bg-gray-800"
								 placeholder="gadget image url" />
					<button disabled={!validURL} onclick={runInstance} title="Run Gadget"
									class="flex flex-row text-sm items-center gap-1 py-1 px-2 rounded cursor-pointer bg-green-800 hover:bg-green-700 disabled:bg-green-950 disabled:text-gray-500 disabled:cursor-not-allowed">
						{@html PlaySmall}
					</button>
				</div>
			</div>
		</div>

		{#if history.length > 0}
			<Section title="History">
				{#snippet icon()}
					<Icon name="adjustments.svg" />
				{/snippet}
				<div class="text-sm">
					{#each history as entry, idx}
						<div class="flex flex-row gap-2 justify-between">
							<div class="flex flex-row gap-2 items-start">
								<div>{entry.image} {#if entry.detached}(detached){/if}</div>
								<!--								<div>-->
								<!--									{#each Object.entries(entry.params) as [key, value]}-->
								<!--										<div>{key} = {value}</div>-->
								<!--									{/each}-->
								<!--								</div>-->
							</div>
							<div class="flex flex-row gap-2 items-end">
								<button class="cursor-pointer hover:text-white" title="Remove from list" onclick={() => { history.splice(idx, 1) }}>{@html Trash}</button>
								<button class="cursor-pointer hover:text-white" title="Run again" onclick={() => { runGadget(entry) }}>{@html PlaySmall}</button>
							</div>
						</div>
					{/each}
				</div>
			</Section>
		<div class="flex flex-col gap-2">
			<div class="flex flex-row gap-2 items-center">
				<div>{@html History}</div>
				<div>Recently run Gadgets</div>
			</div>
			<div class="p-4 bg-gray-950 flex flex-col gap-4 rounded overflow-hidden">
				<div class="text-sm">
					{#each history as entry, idx}
						<div class="flex flex-row gap-2 justify-between">
							<div class="flex flex-row gap-2 items-start">
								<div>{entry.image} {#if entry.detached}(detached){/if}</div>
<!--								<div>-->
<!--									{#each Object.entries(entry.params) as [key, value]}-->
<!--										<div>{key} = {value}</div>-->
<!--									{/each}-->
<!--								</div>-->
							</div>
							<div class="flex flex-row gap-2 items-end">
								<button class="cursor-pointer hover:text-white" title="Remove from list" onclick={() => { history.splice(idx, 1) }}>{@html Trash}</button>
								<button class="cursor-pointer hover:text-white" title="Run again" onclick={() => { runGadget(entry) }}>{@html PlaySmall}</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
		{/if}

		<div class="flex flex-col gap-2">
			<div class="flex flex-row items-center gap-2">
				<div class="flex flex-row gap-2 items-center">
					<div>{@html Server}</div>
					<div>Headless Gadget Instances</div>
				</div>
				<div><a href="https://inspektor-gadget.io/docs/latest/reference/headless" title="Help" target="_blank">{@html Info}</a></div>
			</div>
			<div class="p-2 bg-gray-950 flex flex-col gap-4 rounded overflow-hidden">
				{#if detachedInstances.length}
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
								<td class="text-ellipsis border-r px-2 py-2 border-r-gray-600 last:border-r-0">{instance.id?.substring(0, 12)}</td>
								<td class="text-ellipsis border-r px-2 py-2 border-r-gray-600 last:border-r-0">{instance.name}</td>
								<td class="text-ellipsis border-r px-2 py-2 border-r-gray-600 last:border-r-0">{instance.tags}</td>
								<td class="text-ellipsis border-r px-2 py-2 border-r-gray-600 last:border-r-0">{instance.gadgetConfig?.imageName}</td>
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
				{:else}
					<div class="text-white text-center text-xs p-4">No running instances found</div>
				{/if}
			</div>
		</div>
	</div>
<!--	<div class="flex flex-col w-1/4 p-4">-->
<!--		<div class="flex flex-col p-4 bg-gray-950 rounded"></div>-->
<!--	</div>-->
</div>
{/if}
