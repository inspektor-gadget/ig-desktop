<script lang="js">
	import { getContext } from 'svelte';
	import { goto } from '$app/navigation';
	import Params from '$lib/components/params.svelte';
	import Plus from '$lib/icons/circle-plus.svg?raw';
	import { environments } from '$lib/shared/environments.svelte.js';
	import { page } from '$app/state';

	const api = getContext('api');

	let runtimes = $state(null);

	let env = $derived(environments[page.params.env]);

	let selectedRuntime = $state(env.runtime);
	let contexts = $state([]);

	async function loadRuntimes() {
		const res = await api.request({ cmd: 'getRuntimes' });
		runtimes = res;
	}

	loadRuntimes();

	let runtimeParams = $state([]);
	let values = $state(env.values);
	let name = $state(env.name);

	async function setRuntime(rt) {
		selectedRuntime = rt;
		const res = await api.request({ cmd: 'getRuntimeParams', data: { runtime: rt } });
		runtimeParams = res;
		if (rt === 'grpc-k8s') {
			const res = await api.request({ cmd: 'getKubeContexts' });
			console.log('contexts', res);
			if (res) {
				runtimeParams.unshift({
					key: 'context',
					title: 'Kubernetes Context',
					possibleValues: res
				})
			}
		}
	}

	async function createEnvironment() {
		const res = await api.request({ cmd: 'createEnvironment', data: { name: name, params: values, runtime:
				selectedRuntime } });
		// TODO: Feedback
		console.log('env', res);
		goto('/env/' + res.id);
	}

	let validated = $derived(name.length > 0 && selectedRuntime);
</script>

<div class="flex flex-col shadow-lg z-1">
	<div class="p-4 flex flex-row justify-between bg-gray-950">
		<div class="text-xl">Environment Configuration</div>
	</div>
</div>

<div class="p-4 flex flex-col gap-4 grow overflow-auto">
	<div class="p-4 bg-gray-950 rounded flex flex-row gap-4">
		<div class="text-gray-100 group-hover:rounded-2xl group-hover:bg-brand group-hover:text-white bg-gray-700 rounded-3xl flex items-center justify-center w-12 h-12 transition-all duration-200 overflow-hidden">
			<div class="grid" title={name}>
				<div
					class="col-start-1 row-start-1 flex justify-center text-lg z-10 shadow">{name.substring(0,3)}</div>
			</div>
		</div>
		<div class="flex flex-col gap-2 grow">
			<div>
				<div class="text-lg">Name</div>
			</div>
			<input type="text" bind:value={name} class="w-full p-1.5 text-sm rounded bg-gray-800" />
		</div>
	</div>

	<div class="p-4 bg-gray-950 rounded">
		<div class="flex flex-col gap-2">
			<div>
				<div class="text-lg">Runtime</div>
				<div class="text-gray-400 text-sm">Select your target runtime</div>
			</div>
			<div class="grid grid-cols-2 gap-2">
				{#each runtimes as rt}
					<div onpointerdown={() => { setRuntime(rt.key) }}
							 class="select-none flex flex-col gap-1 cursor-pointer p-4 bg-gray-900 rounded hover:bg-gray-800 border-2"
							 class:border-gray-600={selectedRuntime !== rt.key} class:border-green-600={selectedRuntime === rt.key}>
						<div>{rt.title}</div>
						<div class="text-gray-400 text-sm">{rt.description}</div>
					</div>
				{/each}
			</div>
		</div>
	</div>

	{#if runtimeParams}
		<div class="flex flex-col p-4 bg-gray-950 rounded gap-2">
			<div class="text-lg">Configuration</div>
			<Params params={runtimeParams} values={values} />
		</div>
	{/if}
</div>

<div class="flex flex-row justify-between p-4 bg-gray-950 border-t-1 border-gray-800">
	<div></div>
	<div>
		<button disabled={!validated}
						class="flex flex-row gap-2 py-2 px-4 rounded cursor-pointer bg-green-800 hover:bg-green-700 disabled:bg-green-950 disabled:text-gray-500 disabled:cursor-not-allowed"
						onclick={createEnvironment}>
			<span>{@html Plus}</span>
			<span>Create Environment</span>
		</button>
	</div>
</div>
