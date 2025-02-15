<script>
	import { getContext, setContext } from 'svelte';
	import Params from '$lib/components/params.svelte';
	import Play from '$lib/icons/play.svg?raw';
	import { load } from 'js-yaml';
	import { environments } from '$lib/shared/environments.svelte.js';
	import { goto } from '$app/navigation';
	import Title from '$lib/components/params/title.svelte';

	let { data } = $props();

	const api = getContext('api');

	let environmentID = $state('');

	let detached = $state(false);
	let instanceName = $state('');

	let validated = $derived(environmentID);

	// let gadgetInfo = $state(null);
	let values = $state({});

	let gadgetInfo = $state(null);
	setContext('currentGadget', () => gadgetInfo)

	let error = $state(null);

	let command = $derived.by(() => {
		let cmd = 'ig run ' + data.url;
		Object.keys(values).forEach(key => {
			cmd += ' --' + key + '=' + values[key];
		});
		return cmd;
	});

	let manifest = $derived.by(() => {
		let manifest = 'apiVersion: 1\n';
		manifest += 'kind: instance-spec\n';
		manifest += 'image: ' + data.url + '\n';
		if (instanceName !== '') {
			manifest += 'name: ' + instanceName + '\n';
		}
		manifest += 'paramValues:\n';
		Object.keys(values).forEach(key => {
			manifest += '  ' + key + ': ' + values[key] + '\n';
		});
		manifest += '---\n';
		return manifest;
	});

	$effect(() => {
		if (!environmentID) return;
		api.request({ cmd: 'getGadgetInfo', data: { url: data.url, environmentID: environmentID } }).then((res) => {
			if (!res) {
				error = 'Could not fetch gadget information. Is the given URL correct?';
				return;
			} else {
				error = null;
			}
			gadgetInfo = res;
		});
	});

	async function loadGadgetInfo() {
		const res = await api.request({ cmd: 'getGadgetInfo', data: { url: data.url, environmentID: environmentID } });
		if (!res) {
			error = 'Could not fetch gadget information. Is the given URL correct?';
			return;
		} else {
			error = null;
		}
		gadgetInfo = res;
	}

	async function runGadget() {
		const res = await api.request({ cmd: 'runGadget', data: { image: data.url, params: $state.snapshot(values),
				environmentID: environmentID, detached, instanceName }	});
		console.log(res);
		if (detached) {
			goto('/env/' + environmentID);
		} else {
			goto('/env/' + environmentID + '/running/' + res.id);
		}
	}

	loadGadgetInfo();
</script>
<div class="p-4 flex flex-row justify-between items-center bg-gray-950">
	<div>{data.url}</div>
	<div>
		<div class="grid">
			<svg
				class="pointer-events-none relative right-1 z-10 col-start-1 row-start-1 h-4 w-4 self-center justify-self-end forced-colors:hidden"
				viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
				<path fill-rule="evenodd"
							d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
							clip-rule="evenodd"></path>
			</svg>
			<select bind:value={environmentID} class="col-start-1 row-start-1 pl-3 pr-8 appearance-none p-1.5 rounded bg-gray-800">
				<option value="">Select environment</option>
				{#each Object.entries(environments) as [id, environment]}
					<option value={environment.id}>{environment.name}</option>
				{/each}
			</select>
		</div>
	</div>
</div>

<div class="flex flex-row overflow-auto grow">
	<div class="flex flex-col grow">
		{#if !gadgetInfo}
			{#if error}
				<div class="p-4">{error}</div>
			{:else}
				{#if !environmentID}
					<div class="p-4">
						<div class="p-4 bg-gray-950 rounded gap-4 grid">
							<svg
								class="pointer-events-none relative right-1 z-10 col-start-1 row-start-1 h-4 w-4 self-center justify-self-end forced-colors:hidden"
								viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
								<path fill-rule="evenodd"
											d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
											clip-rule="evenodd"></path>
							</svg>
							<select bind:value={environmentID} class="col-start-1 row-start-1 pl-3 pr-8 appearance-none p-1.5 rounded bg-gray-800">
								<option value="">Select environment</option>
								{#each Object.entries(environments) as [id, environment]}
									<option value={environment.id}>{environment.name}</option>
								{/each}
							</select>
						</div>
					</div>
				{:else}
					<div class="p-4">Loading...</div>
				{/if}
			{/if}
		{:else}
			<div class="p-4">
				<div class="flex flex-col p-4 bg-gray-950 rounded gap-4">
					<div class="flex flex-row gap-4">
						<div><input type="checkbox" class="rounded border border-gray-300" bind:checked={detached} />
						</div>
						<Title
							param={{ title: 'Detached', key: 'detached', description:
									'The server will keep running the gadget even after closing the app' }} />
					</div>

					{#if detached}
						<div class="flex flex-row gap-4">
							<div class="w-1/3">
								<Title
									param={{ title: 'Instance Name', key: 'instanceName', description:
									'Descriptive name for the detached instance' }} />
							</div>
							<div class="grow">
								<input class="w-full p-1.5 text-sm rounded bg-gray-800" type="text" placeholder="My Gadget"
											 bind:value={instanceName}>
							</div>
						</div>
					{/if}
				</div>
			</div>
			<div class="p-4">
				<div class="flex flex-col p-4 bg-gray-950 rounded">
					<Params params={gadgetInfo.params} {values} />
				</div>
			</div>
		{/if}
	</div>
	<div class="flex flex-col w-1/3 p-4 gap-4">
		<div class="flex flex-col gap-2 p-4 p-l-0 bg-gray-800 rounded">
			<div>Run Command</div>
			<div class="bg-gray-700 rounded p-2 text-xs font-mono">{command}</div>
		</div>
		<div class="flex flex-col gap-2 p-4 p-l-0 bg-gray-800 rounded">
			<div>Manifest</div>
			<div class="bg-gray-700 rounded p-2 text-xs whitespace-pre-wrap font-mono">{manifest}</div>
		</div>
	</div>
</div>

<div class="flex flex-row justify-between p-4 bg-gray-950">
	<div></div>
	<div>
		<button disabled={!validated} onclick={runGadget}
						class="flex flex-row gap-2 py-2 pr-4 pl-2 cursor-pointer rounded bg-green-800 hover:bg-green-700 disabled:bg-green-950 disabled:text-gray-500 disabled:cursor-not-allowed">
			<span>{@html Play}</span>
			<span>Run Gadget</span>
		</button>
	</div>
</div>
