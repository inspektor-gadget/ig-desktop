<script lang="ts">
	import DatasourceTable from './Gadget/Table.svelte';
	import DatasourceChart from './Gadget/Chart.svelte';
	import Settings from './GadgetSettings.svelte';
	import Log from './Gadget/Log.svelte';
	import Input from './forms/Input.svelte';

	import Play from '$lib/icons/play.svg?raw';
	import Stop from '$lib/icons/stop.svg?raw';
	import Cog from '$lib/icons/cog.svg?raw';
	import { instances } from '$lib/shared/instances.svelte';
	import { environments } from '$lib/shared/environments.svelte';
	import { getContext, setContext } from 'svelte';
	import { preferences } from '$lib/shared/preferences.svelte';

	let { instanceID }: { instanceID: string } = $props();

	let gadgetInfo = $derived(instances[instanceID]?.gadgetInfo);
	let events = $derived(instances[instanceID]?.events);
	let logs = $derived(instances[instanceID]?.logs);

	let logPane = $state<HTMLDivElement | null>(null);
	let inspectorPane = $state<HTMLDivElement | null>(null);
	let showInspector = $derived(preferences.getDefault('gadget.show-inspector', false));
	let logHeight = $derived(preferences.getDefault('gadget.log-height', 300));
	let inspectorWidth = $derived(preferences.getDefault('gadget.inspector-width', 300));

	function resize(ev: PointerEvent) {
		ev.preventDefault();

		const startY = ev.clientY;
		const startHeight = logPane!.getBoundingClientRect().height;

		const onPointerMove = (e: PointerEvent) => {
			const dy = e.clientY - startY;

			const newHeight = Math.min(500, Math.max(20, startHeight - dy));
			requestAnimationFrame(() => {
				preferences.set('gadget.log-height', newHeight);
			});
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}

	function resizeSidebar(ev: PointerEvent) {
		ev.preventDefault();

		const startX = ev.clientX;
		const startWidth = inspectorPane!.getBoundingClientRect().width;

		const onPointerMove = (e: PointerEvent) => {
			const dy = e.clientX - startX;

			const newWidth = Math.min(700, Math.max(100, startWidth - dy));
			requestAnimationFrame(() => {
				preferences.set('gadget.inspector-width', newWidth);
			});
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}

	const gadget = $state<any>({});
	setContext('gadget', gadget);

	const api: any = getContext('api');

	// Search/filter state (placeholder for future implementation)
	let searchQuery = $state('');

	const instance = $derived(instances[instanceID]);
	const environmentName = $derived(
		instance?.environment ? environments[instance.environment]?.name : ''
	);

	let currentTime = $state(Date.now());

	$effect(() => {
		if (!instance?.running) return;

		const interval = setInterval(() => {
			currentTime = Date.now();
		}, 1000);

		return () => clearInterval(interval);
	});

	const elapsedTime = $derived.by(() => {
		if (!instance?.startTime || !instance?.running) return '';

		const elapsed = Math.floor((currentTime - instance.startTime) / 1000);
		const hours = Math.floor(elapsed / 3600);
		const minutes = Math.floor((elapsed % 3600) / 60);
		const seconds = elapsed % 60;

		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	});

	const eventCount = $derived(instance?.eventCount || 0);

	async function stopInstance(instanceID: string) {
		try {
			const res = await api.request({ cmd: 'stopInstance', data: { id: instanceID } });
		} catch (err) {
			// ignore
		}
	}
</script>

{#if gadgetInfo}
	<div class="flex flex-1 flex-row overflow-hidden">
		<div class="flex flex-1 flex-col overflow-hidden">
			<div class="flex grow flex-col overflow-hidden">
				<div class="flex flex-row items-center justify-between p-2">
					<div class="flex flex-row items-center">
						<div class="flex flex-row items-center pr-2">
							{#if instance.running}
								<button
									onclick={() => {
										stopInstance(instanceID);
									}}>{@html Play}</button
								>
							{:else}
								{@html Stop}
							{/if}
						</div>
						<div>
							{#if instance.running}
								Running
								{#if environmentName}{` on ${environmentName}`}{/if}
							{:else}
								Stopped
							{/if}
						</div>
					</div>
					<div class="flex-1"></div>
					<div class="px-2 font-mono text-sm text-gray-400">{eventCount} events</div>
					{#if elapsedTime}<div class="px-2 font-mono text-sm text-gray-400">
							{elapsedTime}
						</div>{/if}
					<div class="px-2">
						<Input bind:value={searchQuery} placeholder="Search..." class="text-sm" />
					</div>
					<button
						class="cursor-pointer"
						onclick={() => {
							preferences.set('gadget.show-inspector', !showInspector);
						}}>{@html Cog}</button
					>
				</div>
				<div class="flex flex-1 flex-col justify-stretch overflow-y-auto overscroll-none">
					{#each gadgetInfo.dataSources as ds, id}
						{#if ds.annotations?.['view.hidden'] !== 'true'}
							{#if ds.annotations?.['metrics.realtime'] === 'true'}
								<DatasourceChart {ds} dsID={id}></DatasourceChart>
							{:else}
								<DatasourceTable {ds} {events}></DatasourceTable>
							{/if}
						{/if}
					{/each}
				</div>
			</div>
			<div
				class="h-2 cursor-ns-resize touch-none bg-gray-800 select-none"
				onpointerdown={resize}
			></div>
			<div
				bind:this={logPane}
				class="flex flex-col overflow-hidden"
				style="flex: 0 0 {logHeight}px"
			>
				<Log log={logs} />
			</div>
		</div>
		{#if showInspector}
			<div
				class="w-1 cursor-ew-resize touch-none border-r-1 border-r-gray-600 bg-gray-800 select-none"
				onpointerdown={resizeSidebar}
			></div>
			<div
				bind:this={inspectorPane}
				class="flex flex-col overflow-auto"
				style="flex: 0 0 {inspectorWidth}px"
			>
				<div class="flex flex-1 flex-col overflow-hidden">
					<Settings
						{gadgetInfo}
						onclose={() => {
							preferences.set('gadget.show-inspector', false);
						}}
					/>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div
		class="flex flex-1 items-center justify-center bg-gray-900 align-middle font-mono text-gray-100"
	>
		<div>
			<div class="text-xl">Gadget Instance not found</div>
		</div>
	</div>
{/if}
