<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import Params from '$lib/components/Params.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Play from '$lib/icons/play.svg?raw';
	import ChevronLeft from '$lib/icons/chevron-left.svg?raw';
	import ChevronRight from '$lib/icons/chevron-right.svg?raw';
	import Copy from '$lib/icons/copy.svg?raw';
	import Cog from '$lib/icons/cog.svg?raw';
	import Code from '$lib/icons/code.svg?raw';
	import File from '$lib/icons/file.svg?raw';
	import Server from '$lib/icons/server.svg?raw';
	import { environments } from '$lib/shared/environments.svelte';
	import { preferences } from '$lib/shared/preferences.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Title from '$lib/components/params/Title.svelte';
	import type { GadgetInfo, GadgetRunRequest } from '$lib/types';
	import { Clipboard } from '@wailsio/runtime';
	import {
		saveK8sRecent,
		saveGadgetURLRecent,
		addGadgetToHistory
	} from '$lib/utils/env-preferences';
	import { toastStore } from '$lib/stores/toast.svelte';

	let { data }: { data: any } = $props();

	const api: any = getContext('api');

	let environmentID = $state<string | null>(null);
	let detached = $state(false);
	let instanceName = $state('');
	let values = $state<Record<string, any>>({});
	let commandType = $state<'ig' | 'gadgetctl' | 'kubectl'>('ig');
	let showAdvanced = $state(true);

	let validated = $derived(environmentID);

	// Update commandType based on selected environment
	$effect(() => {
		if (!environmentID) return;
		const env = environments[environmentID];
		if (env) {
			// Set to kubectl if runtime contains 'kubernetes', otherwise ig
			commandType = env.runtime && env.runtime.includes('kubernetes') ? 'kubectl' : 'ig';
		}
	});

	let gadgetInfo = $state<GadgetInfo | null>(null);
	setContext('currentGadget', () => gadgetInfo);
	setContext('environmentID', () => environmentID);

	let error = $state<string | null>(null);
	let originalError = $state<string | null>(null);
	let retryTrigger = $state(0);

	// Load initial values from URL parameters
	$effect(() => {
		environmentID = page.url.searchParams.get('env');
		detached = page.url.searchParams.get('detached') === 'true';
		instanceName = page.url.searchParams.get('instanceName') || '';

		const paramsStr = page.url.searchParams.get('params');
		if (paramsStr) {
			try {
				values = JSON.parse(paramsStr);
			} catch (e) {
				console.error('Failed to parse params from URL', e);
				values = {};
			}
		} else {
			values = {};
		}
	});

	let command = $derived.by(() => {
		let baseCmd = 'ig run';
		if (commandType === 'kubectl') {
			baseCmd = 'kubectl gadget run';
		} else if (commandType === 'gadgetctl') {
			baseCmd = 'gadgetctl run';
		}
		let cmd = baseCmd + ' ' + data.url;
		Object.keys(values).forEach((key) => {
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
		Object.keys(values).forEach((key) => {
			manifest += '  ' + key + ': ' + values[key] + '\n';
		});
		manifest += '---\n';
		return manifest;
	});

	$effect(() => {
		if (!environmentID) return;

		// retryTrigger is used to force re-fetch when retry button is clicked
		retryTrigger;

		// Reset states when environment changes
		error = null;
		originalError = null;
		gadgetInfo = null;

		api
			.request({ cmd: 'getGadgetInfo', data: { url: data.url, environmentID: environmentID } })
			.then((res: any) => {
				if (!res) {
					error = 'Could not fetch gadget information. Is the given URL correct?';
					originalError = null;
					return;
				}
				error = null;
				originalError = null;
				gadgetInfo = res;
			})
			.catch((err: any) => {
				console.error('Failed to fetch gadget information:', err);
				originalError = err?.message || String(err);
				error =
					'Failed to fetch gadget information. Please check your environment connection and try again.';
				gadgetInfo = null;
			});
	});

	async function runGadget() {
		const gadgetRunRequest: GadgetRunRequest = {
			image: data.url,
			params: $state.snapshot(values),
			environmentID: environmentID || undefined,
			detached,
			instanceName,
			timestamp: Date.now()
		};

		// Save K8s parameter values to recent lists
		if (environmentID && gadgetInfo?.params) {
			for (const param of gadgetInfo.params) {
				// Only save K8s parameters that have values
				if (param.valueHint?.startsWith('k8s:') && values[(param.prefix || '') + param.key]) {
					const resourceType = param.valueHint.replace('k8s:', '');
					const value = values[(param.prefix || '') + param.key];

					// For arrays (comma-separated), save each value
					if (typeof value === 'string' && value.includes(',')) {
						const parts = value
							.split(',')
							.map((v) => v.trim())
							.filter((v) => v);
						parts.forEach((v) => saveK8sRecent(environmentID, resourceType, v));
					} else if (value) {
						saveK8sRecent(environmentID, resourceType, String(value));
					}
				}
			}
		}

		try {
			const res = await api.request({ cmd: 'runGadget', data: gadgetRunRequest });

			// Save gadget URL to recents
			if (environmentID && data.url) {
				saveGadgetURLRecent(environmentID, data.url);
			}

			// Add to per-environment history with deduplication (max 50 entries)
			if (environmentID) {
				addGadgetToHistory(environmentID, gadgetRunRequest, 50);
			}

			if (detached) {
				// Show info toast for headless instances (success confirmed when instance appears in list)
				const displayName = instanceName || 'Unnamed instance';
				toastStore.info(`Starting headless instance "${displayName}"...`, 3000);
				goto('/env/' + environmentID);
			} else {
				goto('/env/' + environmentID + '/running/' + res.id);
			}
		} catch (err: any) {
			// Show error toast
			const errorMessage = err?.message || err?.toString() || 'Unknown error';
			toastStore.error(
				`Failed to start ${detached ? 'headless instance' : 'gadget'}: ${errorMessage}`,
				7000,
				{
					label: 'Retry',
					onClick: () => runGadget()
				}
			);
		}
	}

	async function copyCommand() {
		await Clipboard.SetText(command);
	}

	async function copyManifest() {
		await Clipboard.SetText(manifest);
	}
</script>

<div class="flex flex-row items-center justify-between bg-gray-950 p-4">
	<div class="flex flex-row items-center gap-4">
		<button
			onclick={() => history.back()}
			class="flex cursor-pointer items-center rounded bg-gray-800 p-1.5 hover:bg-gray-700"
			title="Go back"
		>
			{@html ChevronLeft}
		</button>
		<div>{data.url}</div>
	</div>
	<div>
		<div class="grid">
			<svg
				class="pointer-events-none relative right-1 z-10 col-start-1 row-start-1 h-4 w-4 self-center justify-self-end forced-colors:hidden"
				viewBox="0 0 16 16"
				fill="currentColor"
				aria-hidden="true"
			>
				<path
					fill-rule="evenodd"
					d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
					clip-rule="evenodd"
				></path>
			</svg>
			<select
				bind:value={environmentID}
				class="col-start-1 row-start-1 appearance-none rounded bg-gray-800 p-1.5 pr-8 pl-3"
			>
				<option value="">Select environment</option>
				{#each Object.entries(environments) as [id, environment]}
					<option value={environment.id}>{environment.name}</option>
				{/each}
			</select>
		</div>
	</div>
</div>

<div class="flex grow flex-col overflow-auto bg-gray-950/80 p-8">
	<div class="mx-auto flex w-full max-w-7xl flex-row gap-6">
		<div class="flex grow flex-col gap-6">
			{#if !gadgetInfo}
				{#if error}
					<div
						class="flex flex-col gap-4 rounded-xl border border-red-700 bg-red-950/50 p-6 shadow-lg"
					>
						<div class="flex flex-row items-start gap-4">
							<div class="flex-shrink-0 text-red-400">
								<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
							</div>
							<div class="flex-1">
								<h3 class="text-lg font-semibold text-red-300">
									Failed to Load Gadget Information
								</h3>
								<p class="mt-2 text-sm text-red-400">{error}</p>

								<div class="mt-4 text-sm text-red-300/80">
									<p class="font-semibold">Possible causes:</p>
									<ul class="mt-2 ml-4 list-disc space-y-1">
										<li>The gadget URL is incorrect or the gadget does not exist</li>
										<li>The gadget's signature was not accepted or present</li>
										<li>The selected environment is not reachable or not running</li>
										<li>Network connectivity issues between the app and the environment</li>
										<li>The environment does not have access to the gadget registry</li>
									</ul>
								</div>

								{#if originalError}
									<div class="mt-3 rounded border border-red-800/50 bg-red-900/30 p-3">
										<p class="text-xs font-semibold text-red-300/90">Error details:</p>
										<p class="mt-1 font-mono text-xs text-red-400/80">{originalError}</p>
									</div>
								{/if}

								<button
									onclick={() => {
										retryTrigger++;
									}}
									class="mt-4 rounded bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
								>
									Retry
								</button>
							</div>
						</div>
					</div>
				{:else if !environmentID}
					<Panel title="Select Environment" icon={Server} color="blue">
						<div class="flex flex-col gap-4">
							<p class="text-sm text-gray-400">
								Choose an environment to run this gadget on. Environments define where and how the
								gadget will execute.
							</p>

							{#if Object.keys(environments).length === 0}
								<div
									class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-700 bg-gray-900/30 p-8 text-center"
								>
									<div class="mb-3 text-gray-500">{@html Server}</div>
									<p class="text-sm font-medium text-gray-400">No environments configured</p>
									<p class="mt-2 text-xs text-gray-500">
										Add an environment in the Environments section to get started.
									</p>
								</div>
							{:else}
								<div class="flex flex-col gap-2">
									{#each Object.entries(environments) as [id, environment]}
										<button
											onclick={() => {
												environmentID = environment.id;
											}}
											class="group/item flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-blue-500/50 hover:bg-gray-900"
										>
											<div class="flex flex-col gap-1">
												<div class="font-medium text-gray-200">{environment.name}</div>
												<div class="text-xs text-gray-400">{environment.runtime}</div>
											</div>
											<div
												class="text-gray-600 transition-all group-hover/item:translate-x-1 group-hover/item:text-blue-400"
											>
												{@html ChevronRight}
											</div>
										</button>
									{/each}
								</div>

								<div
									class="mt-2 rounded-lg border border-blue-900/30 bg-blue-950/20 p-3 text-xs text-blue-300/80"
								>
									<span class="font-semibold">Tip:</span> You can also use the environment selector in
									the top-right corner.
								</div>
							{/if}
						</div>
					</Panel>
				{:else}
					<div class="flex items-center justify-center p-8">
						<Spinner message="Loading gadget information..." />
					</div>
				{/if}
			{:else}
				<!-- Panel-like container without header for detached settings -->
				<div
					class="main-gradient flex flex-col gap-4 rounded-xl border border-gray-700 bg-gray-950 p-4 shadow-sm transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10"
				>
					<!-- Detached checkbox -->
					<div class="flex flex-row gap-4">
						<div class="grid items-center justify-center">
							<input
								type="checkbox"
								class="peer col-start-1 row-start-1 h-4 w-4 appearance-none rounded border border-gray-300 ring-transparent checked:border-violet-600 checked:bg-violet-600 dark:border-gray-600 dark:checked:border-violet-600 forced-colors:appearance-auto"
								bind:checked={detached}
							/>
							<svg
								viewBox="0 0 14 14"
								fill="none"
								class="pointer-events-none invisible col-start-1 row-start-1 stroke-white peer-checked:visible dark:text-violet-300 forced-colors:hidden"
								><path
									d="M3 8L6 11L11 3.5"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								></path></svg
							>
						</div>
						<Title
							param={{
								title: 'Detached',
								key: 'detached',
								description: 'The server will keep running the gadget even after closing the app'
							}}
							onclick={() => {
								detached = !detached;
							}}
						/>
					</div>

					<!-- Instance name input when detached -->
					{#if detached}
						<div class="flex flex-row gap-4">
							<div class="w-1/3">
								<Title
									param={{
										title: 'Instance Name',
										key: 'instanceName',
										description: 'Descriptive name for the detached instance'
									}}
								/>
							</div>
							<div class="grow">
								<input
									class="w-full rounded bg-gray-800 p-1.5 text-sm"
									type="text"
									placeholder="My Gadget"
									bind:value={instanceName}
								/>
							</div>
						</div>
					{/if}
				</div>

				<Panel title="Parameters" icon={Cog} color="blue">
					{#snippet headerActions()}
						<div class="flex flex-row items-center gap-2">
							<input type="checkbox" bind:checked={showAdvanced} />
							<button
								onclick={() => {
									showAdvanced = !showAdvanced;
								}}
								class="text-xs">Show advanced options</button
							>
						</div>
					{/snippet}

					<Params params={gadgetInfo.params} {values} {showAdvanced} />
				</Panel>
			{/if}
		</div>

		<div class="flex w-1/3 flex-col gap-6">
			<Panel title="Run Command" icon={Code} color="green">
				{#snippet headerActions()}
					<button
						onclick={copyCommand}
						class="cursor-pointer rounded p-1 hover:bg-gray-700"
						title="Copy to clipboard"
					>
						{@html Copy}
					</button>
				{/snippet}

				<div class="flex flex-col gap-4">
					<div class="rounded bg-gray-800 p-3 font-mono text-xs">{command}</div>
					<div class="flex flex-row items-center">
						<button
							onclick={() => (commandType = 'ig')}
							class="flex-1 rounded-l px-2 py-1 text-xs transition-colors"
							class:bg-gray-600={commandType === 'ig'}
							class:hover:bg-gray-500={commandType === 'ig'}
							class:bg-gray-700={commandType !== 'ig'}
							class:hover:bg-gray-600={commandType !== 'ig'}
						>
							ig
						</button>
						<button
							onclick={() => (commandType = 'gadgetctl')}
							class="flex-1 px-2 py-1 text-xs transition-colors"
							class:bg-gray-600={commandType === 'gadgetctl'}
							class:hover:bg-gray-500={commandType === 'gadgetctl'}
							class:bg-gray-700={commandType !== 'gadgetctl'}
							class:hover:bg-gray-600={commandType !== 'gadgetctl'}
						>
							gadgetctl
						</button>
						<button
							onclick={() => (commandType = 'kubectl')}
							class="flex-1 rounded-r px-2 py-1 text-xs transition-colors"
							class:bg-gray-600={commandType === 'kubectl'}
							class:hover:bg-gray-500={commandType === 'kubectl'}
							class:bg-gray-700={commandType !== 'kubectl'}
							class:hover:bg-gray-600={commandType !== 'kubectl'}
						>
							kubectl
						</button>
					</div>
				</div>
			</Panel>

			<Panel title="Manifest" icon={File} color="purple">
				{#snippet headerActions()}
					<button
						onclick={copyManifest}
						class="cursor-pointer rounded p-1 hover:bg-gray-700"
						title="Copy to clipboard"
					>
						{@html Copy}
					</button>
				{/snippet}

				<div class="rounded bg-gray-800 p-3 font-mono text-xs whitespace-pre-wrap">{manifest}</div>
			</Panel>
		</div>
	</div>
</div>

<div class="flex flex-row justify-between bg-gray-950 p-4">
	<div></div>
	<div>
		<button
			disabled={!validated}
			onclick={runGadget}
			class="flex cursor-pointer flex-row gap-2 rounded bg-green-800 py-2 pr-4 pl-2 hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-950 disabled:text-gray-500"
		>
			<span>{@html Play}</span>
			<span>Run Gadget</span>
		</button>
	</div>
</div>
