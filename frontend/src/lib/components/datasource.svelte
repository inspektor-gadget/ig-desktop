<script lang="js">
	import DatasourceTable from './ds-table.svelte';
	import DatasourceChart from './ds-chart.svelte';
	import Settings from './gadget-settings.svelte';
	import Log from './log.svelte';

	import Play from '$lib/icons/play.svg?raw';
	import Stop from '$lib/icons/stop.svg?raw';
	import Cog from '$lib/icons/cog.svg?raw';
	import { instances } from '$lib/shared/instances.svelte.js';
	import { getContext, setContext } from 'svelte';
	import { preferences } from '$lib/shared/preferences.svelte.js';
	import Flamegraph from './flamegraph.svelte';

	let { instanceID } = $props();

	let gadgetInfo = $derived(instances[instanceID]?.gadgetInfo);
	let events = $derived(instances[instanceID]?.events);
	let logs = $derived(instances[instanceID]?.logs);

	let logPane = $state(null);
	let inspectorPane = $state(null);
	let showInspector = $derived(preferences.getDefault('gadget.show-inspector', false));
	let logHeight = $derived(preferences.getDefault('gadget.log-height', 300));
	let inspectorWidth = $derived(preferences.getDefault('gadget.inspector-width', 300));

	function resize(ev) {
		ev.preventDefault();

		const startY = ev.clientY;
		const startHeight = logPane.getBoundingClientRect().height;

		const onPointerMove = (e) => {
			const dy = e.clientY - startY;

			const newHeight = Math.min(500, Math.max(20, startHeight - dy));
			preferences.set('gadget.log-height', newHeight);
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}

	function resizeSidebar(ev) {
		ev.preventDefault();

		const startX = ev.clientX;
		const startWidth = inspectorPane.getBoundingClientRect().width;

		const onPointerMove = (e) => {
			const dy = e.clientX - startX;

			const newWidth = Math.min(700, Math.max(100, startWidth - dy));
			preferences.set('gadget.inspector-width', newWidth);
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}

	const gadget = $state({});
	setContext('gadget', gadget);

	const api = getContext('api');

	const instance = $derived(instances[instanceID]);

	async function stopInstance(instanceID) {
		try {
			const res = await api.request({ cmd: 'stopInstance', data: { id: instanceID } });
		} catch (err) {
			// ignore
		}
	}
</script>

{#if gadgetInfo}
	<div class="flex-1 flex overflow-hidden flex-row">
		<div class="flex-1 flex flex-col overflow-hidden">
			<div class="flex flex-col grow overflow-hidden">
				<div class="p-2 flex flex-row justify-between items-center">
					<div class="flex flex-row items-center">
						<div class="flex flex-row pr-2 items-center">
							{#if instance.running}
								<button	onclick={() => { stopInstance(instanceID) }}>{@html Play}</button>
							{:else}
								{@html Stop}
							{/if}
						</div>
						<div>
							{#if instance.running}
								Running
							{:else}
								Stopped
							{/if}
						</div>
					</div>
					<div class="flex-1"></div>
					<div class="px-2"><input class="rounded text-sm bg-gray-800 p-1" type="text" /></div>
					<button class="cursor-pointer"
									onclick={()=>{ preferences.set('gadget.show-inspector', !showInspector); }}>{@html Cog}</button>
				</div>
				<div class="flex flex-col flex-1 justify-stretch overflow-y-auto overscroll-none">
					{#each gadgetInfo.dataSources as ds, id}
						{#if ds.annotations?.['view.hidden'] !== 'true'}
							{#if ds.annotations?.['metrics.realtime'] === 'true'}
								<DatasourceChart {ds} dsID={id}></DatasourceChart>
							{:else}
								<DatasourceTable {ds} {events}></DatasourceTable>
								<Flamegraph {ds} {events} />
							{/if}
						{/if}
					{/each}
				</div>
			</div>
			<div class="h-2 bg-gray-800 cursor-ns-resize touch-none select-none" onpointerdown={resize}></div>
			<div bind:this={logPane} class="flex flex-col overflow-hidden" style="flex: 0 0 {logHeight}px">
				<Log log={logs} />
			</div>
		</div>
		{#if showInspector}
			<div class="w-1 bg-gray-800 border-r-1 border-r-gray-600 cursor-ew-resize touch-none select-none"
					 onpointerdown={resizeSidebar}></div>
			<div bind:this={inspectorPane} class="overflow-auto flex flex-col" style="flex: 0 0 {inspectorWidth}px">
				<div class="flex flex-col flex-1 overflow-hidden">
					<Settings {gadgetInfo} onclose={() => { preferences.set('gadget.show-inspector', false); }} />
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="flex-1 flex text-gray-100 bg-gray-900 items-center justify-center align-middle font-mono">
		<div>
			<div class="text-xl">Gadget information not available</div>
		</div>
	</div>
	<div class="h-2 bg-gray-800 cursor-ns-resize touch-none select-none" onpointerdown={resize}></div>
	<div bind:this={logPane} class="flex flex-col overflow-hidden" style="flex: 0 0 {logHeight}px">
		<Log log={logs} />
	</div>
{/if}
