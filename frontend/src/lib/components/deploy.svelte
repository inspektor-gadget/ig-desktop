<script>
	import Params from "./params.svelte";
	import { getContext } from 'svelte';
	import Play from '$lib/icons/play.svg?raw';

	let { environmentID } = $props();

	let params = $state([]);
	let values = $derived(params.reduce((acc, param) => { acc[(param.prefix || '') + param.key] = param.defaultValue; return acc; }, {}));

	const api = getContext('api');

	async function getDeploymentParams() {
		const res = await api.request({
			cmd: 'getDeploymentParams',
		});
		params = res;
	}

	async function deploy() {
		const res = await api.request({
			cmd: 'deploy',
			data: {
				environmentID: environmentID,
				params: values,
			}
		})
	}

	getDeploymentParams();
</script>

<div class="flex flex-col overflow-auto grow">
	<div class="flex flex-col flex-1 min-w-0 bg-gray-900 p-4 gap-4">
		<div class="flex flex-col bg-gray-950 p-4 rounded">
			Inspektor Gadget has not been deployed on the cluster.
		</div>
		<div class="flex flex-col bg-gray-950 p-4 rounded">
			<Params {params} {values} />
		</div>
	</div>
</div>
<div class="flex flex-row justify-between p-4 bg-gray-950 border-t-1 border-gray-800">
	<div></div>
	<div>
		<button disabled={false} onclick={deploy}
						class="flex flex-row gap-2 py-2 pr-4 pl-2 cursor-pointer rounded bg-green-800 hover:bg-green-700 disabled:bg-green-950 disabled:text-gray-500 disabled:cursor-not-allowed">
			<span>{@html Play}</span>
			<span>Deploy on Cluster</span>
		</button>
	</div>
</div>
