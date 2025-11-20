<script lang="ts">
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import { environments } from '$lib/shared/environments.svelte';
	import { instances } from '$lib/shared/instances.svelte';
	import { goto } from '$app/navigation';
	import type { GadgetInstance, GadgetRunRequest } from '$lib/types';
	import Panel from '$lib/components/Panel.svelte';
	import { confirmationModal } from '$lib/stores/confirmation-modal.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import BaseModal from '$lib/components/BaseModal.svelte';
	import Button from '$lib/components/Button.svelte';

	import Browser from '$lib/icons/fa/browser.svg?raw';
	import Trash from '$lib/icons/fa/trash.svg?raw';
	import PlaySmall from '$lib/icons/fa/play.svg?raw';
	import History from '$lib/icons/fa/clock-rotate-left.svg?raw';
	import Info from '$lib/icons/fa/info.svg?raw';
	import Server from '$lib/icons/fa/server.svg?raw';
	import Cog from '$lib/icons/cog-small.svg?raw';
	import ChevronLeft from '$lib/icons/chevron-left.svg?raw';
	import ChevronRight from '$lib/icons/chevron-right.svg?raw';
	import Grid from '$lib/icons/grid-small.svg?raw';
	import { preferences } from '$lib/shared/preferences.svelte';
	import { formatAbsoluteTime, formatRelativeTime } from '$lib/utils/time';
	import { currentEnvironment } from '$lib/shared/current-environment.svelte';
	import {
		cleanupEnvironment,
		getGadgetURLRecents,
		saveGadgetURLRecent,
		getEnvPref,
		setEnvPref
	} from '$lib/utils/env-preferences';
	import AutocompleteInput from '$lib/components/forms/AutocompleteInput.svelte';

	const api: any = getContext('api');

	let env = $derived(environments[page.params.env || '']);

	let detachedInstances = $state<GadgetInstance[]>([]);

	let targetState = $state(0);
	let currentEnvId = $state<string | null>(null);

	let gadgetURL = $state('');
	let validURL = $derived(gadgetURL !== '');

	// Recent gadget URLs
	let gadgetURLOptions = $derived(() => {
		if (!env?.id) return [];
		const recents = getGadgetURLRecents(env.id);
		return recents.map((url) => ({ value: url, label: url, isRecent: true }));
	});

	let settingsModalOpen = $state(false);

	$effect(() => {
		if (!env) {
			currentEnvironment.clear();
			return;
		}
		currentEnvId = env.id;
		detachedInstances = [];
		currentEnvironment.setEnvironment(env);
		getList(env.id);

		// Poll for headless instances every 7 seconds
		const pollInterval = setInterval(() => {
			if (currentEnvId === env.id) {
				getList(env.id);
			}
		}, 7000);

		// Cleanup interval on effect re-run or component unmount
		return () => {
			clearInterval(pollInterval);
		};
	});

	// Make history reactive state instead of derived
	let history = $state<GadgetRunRequest[]>([]);

	// Load history when environment changes
	$effect(() => {
		if (!env?.id) {
			history = [];
			return;
		}
		history = getEnvPref<GadgetRunRequest[]>(env.id, 'gadget-history') || [];
	});

	// Pagination for history
	const ITEMS_PER_PAGE = 5;
	let currentPage = $state(0);
	const totalPages = $derived(Math.max(1, Math.ceil(history.length / ITEMS_PER_PAGE)));
	const paginatedHistory = $derived(
		history.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE)
	);

	// Reset to first page if current page is out of bounds
	$effect(() => {
		if (currentPage >= totalPages) {
			currentPage = Math.max(0, totalPages - 1);
		}
	});

	async function getList(requestedEnvId: string) {
		targetState = 0;
		currentEnvironment.setConnectionStatus('connecting');
		try {
			const tmp = await api.request({
				cmd: 'listInstances',
				data: { environmentID: requestedEnvId }
			});
			// Only update state if this is still the current environment
			if (requestedEnvId === currentEnvId) {
				detachedInstances = tmp.gadgetInstances || []; // TODO: check why this can return empty
				targetState = 1;
				currentEnvironment.setConnectionStatus('connected');
			}
		} catch (err) {
			// Only update state if this is still the current environment
			if (requestedEnvId === currentEnvId) {
				targetState = 2;
				currentEnvironment.setConnectionStatus('error', (err as Error).message);
			}
		}
	}

	async function deleteEnvironment() {
		const confirmed = await confirmationModal.confirm({
			title: 'Delete Environment',
			message: 'Do you really want to delete this environment?',
			confirmLabel: 'Delete',
			cancelLabel: 'Cancel'
		});
		if (!confirmed) return;
		const res = await api.request({ cmd: 'deleteEnvironment', data: { id: env.id } });

		// Clean up all environment-scoped preferences
		cleanupEnvironment(env.id);

		goto('/');
	}

	async function attachInstance(instance: GadgetInstance) {
		const res = await api.request({
			cmd: 'attachInstance',
			data: { environmentID: env.id, image: instance.id }
		});
		console.log('attachInstance', res);
		goto('/env/' + env.id + '/running/' + res.id);
	}

	async function removeInstance(instance: GadgetInstance) {
		const confirmed = await confirmationModal.confirm({
			title: 'Remove Instance',
			message: 'Do you really want to remove this instance?',
			confirmLabel: 'Remove',
			cancelLabel: 'Cancel'
		});
		if (!confirmed) return;

		try {
			const res = await api.request({
				cmd: 'removeInstance',
				data: { environmentID: env.id, id: instance.id }
			});
			console.log('removeInstance', res);

			// Show success toast
			const instanceName = instance.name || instance.id.substring(0, 8);
			toastStore.success(`Instance "${instanceName}" removed successfully`);

			getList(env.id);
		} catch (err: any) {
			// Show error toast
			const errorMessage = err?.message || err?.toString() || 'Unknown error';
			const instanceName = instance.name || instance.id.substring(0, 8);
			toastStore.error(`Failed to remove instance "${instanceName}": ${errorMessage}`, 7000, {
				label: 'Retry',
				onClick: () => removeInstance(instance)
			});
		}
	}

	function runInstance() {
		// Save URL to recents
		if (env?.id && gadgetURL) {
			saveGadgetURLRecent(env.id, gadgetURL);
		}
		goto('/gadgets/run/' + gadgetURL + '?env=' + env.id);
	}

	async function runGadget(gadgetRunRequest: GadgetRunRequest) {
		try {
			const res = await api.request({
				cmd: 'runGadget',
				data: { ...gadgetRunRequest, environmentID: env.id }
			});
			if (gadgetRunRequest.detached) {
				// Show info toast for headless instances (success confirmed when instance appears in list)
				const displayName = gadgetRunRequest.instanceName || 'Unnamed instance';
				toastStore.info(`Starting headless instance "${displayName}"...`, 3000);
				getList(env.id);
			} else {
				goto('/env/' + env.id + '/running/' + res.id);
			}
		} catch (err: any) {
			// Show error toast
			const errorMessage = err?.message || err?.toString() || 'Unknown error';
			toastStore.error(
				`Failed to start ${gadgetRunRequest.detached ? 'headless instance' : 'gadget'}: ${errorMessage}`,
				7000,
				{
					label: 'Retry',
					onClick: () => runGadget(gadgetRunRequest)
				}
			);
		}
	}
</script>

{#if !env}
	<div class="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
		<div class="text-gray-600">{@html Server}</div>
		<div class="text-sm text-gray-500">Environment not found</div>
	</div>
{:else}
	<div class="flex flex-1 flex-col gap-8 overflow-auto p-8 text-gray-100">
		<div class="mx-auto w-full max-w-7xl">
			<!-- Page Header -->
			<div class="mb-8 flex items-start justify-between gap-6">
				<div class="flex flex-col gap-3">
					<h1 class="text-4xl font-bold">
						{env.name}
					</h1>
				</div>
				<button
					onclick={() => (settingsModalOpen = true)}
					class="cursor-pointer rounded-lg border border-gray-800 bg-gray-900/50 p-3 text-gray-400 transition-all hover:border-blue-500/50 hover:bg-gray-900 hover:text-blue-400"
					title="Environment Settings"
				>
					{@html Cog}
				</button>
			</div>

			<!-- Content Grid -->
			<div class="grid grid-cols-1 gap-6">
				<!-- Run Gadget Card -->
				<Panel title="Run Gadget" icon={PlaySmall} color="blue" bodyPadding="large">
					<p class="mb-2 text-sm text-gray-400">
						Enter a gadget image URL or discover gadgets from ArtifactHub
					</p>
					<div class="flex flex-col gap-2 md:flex-row">
						<a
							href="/browse/artifacthub?env={env.id}"
							title="Discover Gadgets"
							class="flex min-h-[42px] cursor-pointer flex-row items-center justify-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-2 text-sm transition-all hover:border-blue-500/50 hover:bg-gray-900 md:w-auto md:justify-start"
						>
							<span class="text-blue-400">{@html Grid}</span>
							<span class="text-gray-200">Discover</span>
						</a>
						<div class="grow">
							<AutocompleteInput
								bind:value={gadgetURL}
								options={gadgetURLOptions()}
								placeholder="ghcr.io/inspektor-gadget/gadget/trace_open:latest"
								allowCustom={true}
								onSelect={(val) => {
									if (typeof val === 'string') {
										gadgetURL = val;
									}
								}}
								onEnter={runInstance}
							/>
						</div>
						<button
							disabled={!validURL}
							onclick={runInstance}
							title="Run Gadget"
							class="flex min-h-[42px] cursor-pointer flex-row items-center justify-center gap-2 rounded-lg border border-blue-800 bg-blue-900/20 px-4 py-2 text-sm text-blue-400 transition-all hover:border-blue-500/50 hover:bg-blue-900/40 disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-900/20 disabled:text-gray-600 md:w-auto"
						>
							<span>{@html PlaySmall}</span>
							<span>Run</span>
						</button>
					</div>
				</Panel>

				<!-- Recently Run Gadgets Card -->
				{#if history.length > 0}
					<Panel
						title="Recently run Gadgets"
						icon={History}
						color="purple"
						badge={history.length}
						bodyPadding="large"
					>
						{#snippet headerActions()}
							<button
								onclick={() => currentPage--}
								disabled={currentPage === 0}
								class="cursor-pointer text-gray-400 transition-all hover:text-purple-400 disabled:cursor-not-allowed disabled:text-gray-700"
								title="Previous page"
							>
								{@html ChevronLeft}
							</button>
							<span class="text-xs text-gray-500">{currentPage + 1} / {totalPages}</span>
							<button
								onclick={() => currentPage++}
								disabled={currentPage >= totalPages - 1}
								class="cursor-pointer text-gray-400 transition-all hover:text-purple-400 disabled:cursor-not-allowed disabled:text-gray-700"
								title="Next page"
							>
								{@html ChevronRight}
							</button>
						{/snippet}

						{#each paginatedHistory as entry, idx}
							<div
								class="group/item flex flex-col gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4 transition-all hover:border-purple-500/50 hover:bg-gray-900"
							>
								<div class="flex flex-row items-start justify-between gap-4">
									<div class="flex flex-1 flex-col gap-2">
										<div class="flex flex-row items-center gap-2 font-mono text-sm">
											<span class="font-medium text-gray-200">{entry.image}</span>
											{#if entry.detached}
												<span class="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400"
													>detached</span
												>
											{/if}
											{#if entry.instanceName}
												<span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400"
													>{entry.instanceName}</span
												>
											{/if}
											{#if entry.timestamp}
												<span
													class="cursor-help text-xs text-gray-500"
													title={formatAbsoluteTime(entry.timestamp)}
													>{formatRelativeTime(entry.timestamp)}</span
												>
											{/if}
										</div>
										{#if entry.params && Object.keys(entry.params).length > 0}
											<div class="flex flex-row flex-wrap gap-2 text-xs">
												{#each Object.entries(entry.params) as [key, value]}
													<span
														class="rounded-lg border border-gray-800 bg-gray-950/50 px-2 py-1 font-mono"
														><span class="text-gray-500">{key}:</span>
														<span class="text-gray-300">{value}</span></span
													>
												{/each}
											</div>
										{/if}
									</div>
									<div class="flex flex-row items-start gap-1">
										<button
											class="cursor-pointer rounded p-1.5 text-gray-500 transition-all hover:bg-gray-800 hover:text-red-400"
											title="Remove from list"
											onclick={() => {
												const actualIdx = currentPage * ITEMS_PER_PAGE + idx;
												history.splice(actualIdx, 1);
												setEnvPref(env.id, 'gadget-history', history);
											}}>{@html Trash}</button
										>
										<button
											class="cursor-pointer rounded p-1.5 text-gray-500 transition-all hover:bg-gray-800 hover:text-gray-200"
											title="Configure and run"
											onclick={() => {
												const params = new URLSearchParams();
												params.set('env', env.id);
												if (entry.params) {
													params.set('params', JSON.stringify(entry.params));
												}
												if (entry.detached !== undefined) {
													params.set('detached', String(entry.detached));
												}
												if (entry.instanceName) {
													params.set('instanceName', entry.instanceName);
												}
												goto('/gadgets/run/' + entry.image + '?' + params.toString());
											}}>{@html Cog}</button
										>
										<button
											class="cursor-pointer rounded p-1.5 text-gray-500 transition-all hover:bg-gray-800 hover:text-purple-400"
											title="Run again"
											onclick={() => {
												runGadget(entry);
											}}>{@html PlaySmall}</button
										>
									</div>
								</div>
							</div>
						{/each}
					</Panel>
				{/if}

				<!-- Headless Gadget Instances Card -->
				<Panel
					title="Headless Gadget Instances"
					icon={Server}
					color="blue"
					badge={detachedInstances.length > 0 ? detachedInstances.length : undefined}
					bodyPadding="large"
				>
					{#snippet headerActions()}
						<a
							href="https://inspektor-gadget.io/docs/latest/reference/headless"
							title="Documentation"
							target="_blank"
							class="text-gray-400 transition-all hover:text-blue-400">{@html Info}</a
						>
					{/snippet}

					{#if detachedInstances.length}
						<div class="overflow-x-auto">
							<table class="w-full min-w-full">
								<thead>
									<tr class="border-b border-gray-800">
										<th
											class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase"
											>ID</th
										>
										<th
											class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase"
											>Name</th
										>
										<th
											class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase"
											>Tags</th
										>
										<th
											class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase"
											>Image</th
										>
										<th class="px-4 py-3"></th>
									</tr>
								</thead>
								<tbody>
									{#each detachedInstances as instance}
										<tr
											class="group/item border-b border-gray-800 transition-all last:border-b-0 hover:bg-gray-900/50"
										>
											<td class="px-4 py-3 font-mono text-sm text-gray-400"
												>{instance.id?.substring(0, 12)}</td
											>
											<td class="px-4 py-3 text-sm text-gray-300">{instance.name}</td>
											<td class="px-4 py-3 font-mono text-xs text-gray-500">{instance.tags}</td>
											<td class="px-4 py-3 font-mono text-xs text-gray-400"
												>{instance.gadgetConfig?.imageName}</td
											>
											<td class="px-4 py-3">
												<div class="flex flex-row justify-end gap-1">
													<button
														class="cursor-pointer rounded p-1.5 text-gray-500 transition-all hover:bg-gray-800 hover:text-blue-400"
														title="Attach"
														onclick={() => {
															attachInstance(instance);
														}}>{@html Browser}</button
													>
													<button
														class="cursor-pointer rounded p-1.5 text-gray-500 transition-all hover:bg-gray-800 hover:text-red-400"
														title="Delete"
														onclick={() => {
															removeInstance(instance);
														}}>{@html Trash}</button
													>
												</div>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{:else}
						<div class="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
							<div class="text-gray-600">{@html Server}</div>
							<div class="text-sm text-gray-500">No running instances found</div>
						</div>
					{/if}
				</Panel>
			</div>
		</div>

		<!-- Settings Modal -->
		<BaseModal
			bind:open={settingsModalOpen}
			title="Environment Settings"
			icon={Cog}
			size="lg"
			onClose={() => (settingsModalOpen = false)}
		>
			<div class="flex flex-col gap-6">
				<!-- Environment Name -->
				<div class="flex flex-col gap-2">
					<label class="text-sm font-semibold tracking-wide text-gray-500 uppercase">Name</label>
					<div class="rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-gray-200">
						{env.name}
					</div>
				</div>

				<!-- Environment ID -->
				<div class="flex flex-col gap-2">
					<label class="text-sm font-semibold tracking-wide text-gray-500 uppercase">ID</label>
					<div
						class="rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 font-mono text-sm text-gray-400"
					>
						{env.id}
					</div>
				</div>

				<!-- Runtime -->
				<div class="flex flex-col gap-2">
					<label class="text-sm font-semibold tracking-wide text-gray-500 uppercase">Runtime</label>
					<div class="rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-gray-200">
						{env.runtime}
					</div>
				</div>

				<!-- Parameters -->
				{#if env.params && Object.keys(env.params).length > 0}
					<div class="flex flex-col gap-2">
						<label class="text-sm font-semibold tracking-wide text-gray-500 uppercase"
							>Configuration</label
						>
						<div class="flex flex-col gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4">
							{#each Object.entries(env.params) as [key, value]}
								<div class="flex flex-col gap-1">
									<div class="text-xs font-medium text-gray-500">{key}</div>
									<div class="font-mono text-sm text-gray-300">{value}</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Danger Zone -->
				<div class="mt-4 flex flex-col gap-4 rounded-lg border border-red-800/50 bg-red-900/10 p-4">
					<div class="flex flex-col gap-1">
						<h3 class="font-semibold text-red-400">Danger Zone</h3>
						<p class="text-sm text-gray-400">Irreversible actions for this environment</p>
					</div>
					<Button variant="danger" onclick={() => deleteEnvironment()} class="justify-center">
						<span>{@html Trash}</span>
						<span>Delete Environment</span>
					</Button>
				</div>
			</div>
		</BaseModal>
	</div>
{/if}
