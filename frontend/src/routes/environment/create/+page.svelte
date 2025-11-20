<script lang="ts">
	import { getContext } from 'svelte';
	import { goto } from '$app/navigation';
	import Panel from '$lib/components/Panel.svelte';
	import Params from '$lib/components/Params.svelte';
	import K8sDeployModal from '$lib/components/K8sDeployModal.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { deployments } from '$lib/shared/deployments.svelte';
	import Plus from '$lib/icons/circle-plus.svg?raw';
	import Server from '$lib/icons/server-small.svg?raw';
	import Refresh from '$lib/icons/refresh-small.svg?raw';
	import Info from '$lib/icons/info.svg?raw';
	import Trash from '$lib/icons/fa/trash.svg?raw';
	import Code from '$lib/icons/code.svg?raw';
	import Adjustments from '$lib/icons/adjustments.svg?raw';
	import type { IGDeploymentStatus, RuntimeInfo } from '$lib/types';
	import Input from '$lib/components/forms/Input.svelte';
	import Select from '$lib/components/forms/Select.svelte';

	const api: any = getContext('api');

	// Watch for successful deployments and refresh status
	$effect(() => {
		const activeDeployment = deployments.getActive();
		// When a deployment completes successfully, refresh the deployment status
		if (
			activeDeployment?.status === 'success' &&
			selectedRuntime === 'grpc-k8s' &&
			!checkingDeployment
		) {
			// Small delay to allow K8s to fully register the deployment/removal
			setTimeout(() => {
				checkDeploymentStatus();
				// Clean up completed deployment from state after status refresh
				if (activeDeployment.id) {
					deployments.remove(activeDeployment.id);
				}
			}, 2000);
		}
	});

	let runtimes = $state<RuntimeInfo[] | null>(null);
	let selectedRuntime = $state<string | null>(null);
	let deploymentStatus = $state<IGDeploymentStatus | null>(null);
	let checkingDeployment = $state(false);
	let deployModalOpen = $state(false);

	async function loadRuntimes() {
		const res = await api.request({ cmd: 'getRuntimes' });
		console.log(res);
		runtimes = res;
	}

	loadRuntimes();

	let runtimeParams = $state<any[]>([]);
	let values = $state<Record<string, any>>({});
	let name = $state('');
	let selectedContext = $state<string>('');

	async function setRuntime(rt: string) {
		selectedRuntime = rt;
		const res = await api.request({ cmd: 'getRuntimeParams', data: { runtime: rt } });
		runtimeParams = res;

		// Preselect first context for K8s runtime
		if (rt === 'grpc-k8s') {
			const runtime = runtimes?.find((r) => r.key === 'grpc-k8s');
			if (runtime?.contexts && runtime.contexts.length > 0 && !selectedContext) {
				selectedContext = runtime.contexts[0];
			}
			await checkDeploymentStatus();
		}
	}

	async function checkDeploymentStatus() {
		checkingDeployment = true;
		try {
			const res = await api.request({
				cmd: 'checkIGDeployment',
				data: { namespace: 'gadget', kubeContext: selectedContext }
			});
			deploymentStatus = res;
		} catch (err) {
			console.error('Failed to check deployment status:', err);
			deploymentStatus = { deployed: false, error: String(err) };
		} finally {
			checkingDeployment = false;
		}
	}

	async function handleContextChange() {
		if (selectedRuntime === 'grpc-k8s') {
			await checkDeploymentStatus();
		}
	}

	async function createEnvironment() {
		const params = { ...values };

		// Add selected context for Kubernetes runtime
		if (selectedRuntime === 'grpc-k8s' && selectedContext) {
			params.context = selectedContext;
		}

		const res = await api.request({
			cmd: 'createEnvironment',
			data: { name: name, params: params, runtime: selectedRuntime }
		});
		// TODO: Feedback
		console.log('env', res);
		goto('/env/' + res.id);
	}

	let isRedeploy = $state(false);
	let isUndeploy = $state(false);

	function openDeployModal() {
		isRedeploy = false;
		isUndeploy = false;
		deployModalOpen = true;
	}

	function openRedeployModal() {
		isRedeploy = true;
		isUndeploy = false;
		deployModalOpen = true;
	}

	function openUndeployModal() {
		isRedeploy = false;
		isUndeploy = true;
		deployModalOpen = true;
	}

	function closeDeployModal() {
		deployModalOpen = false;
		isRedeploy = false;
		isUndeploy = false;
		// Refresh deployment status after modal closes
		if (selectedRuntime === 'grpc-k8s') {
			checkDeploymentStatus();
		}
	}

	let validated = $derived(name.length > 0 && selectedRuntime);
</script>

<div class="z-1 flex flex-col shadow-lg">
	<div class="flex flex-row justify-between bg-gray-950 p-4">
		<div class="text-xl">Create Environment</div>
	</div>
</div>

<div class="flex grow flex-col overflow-auto p-8">
	<div class="mx-auto flex w-full max-w-7xl flex-col gap-4">
		<Panel title="Environment Name" icon={Plus} color="gray">
			<div class="flex flex-row items-center gap-4">
				<div
					class="group-hover:bg-brand flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-gray-700 text-gray-100 transition-all duration-200 group-hover:rounded-2xl group-hover:text-white"
				>
					<div class="grid" title={name}>
						<div class="z-10 col-start-1 row-start-1 flex justify-center text-lg shadow">
							{name.substring(0, 3)}
						</div>
					</div>
				</div>
				<div class="flex grow flex-col gap-2">
					<Input bind:value={name} placeholder="Enter environment name..." class="text-sm" />
				</div>
			</div>
		</Panel>

		<Panel title="Runtime" icon={Code} color="gray">
			<div class="flex flex-col gap-3">
				<div class="text-sm text-gray-400">Select your target runtime</div>
				<div class="grid grid-cols-2 gap-3">
					{#if runtimes}
						{#each runtimes as rt}
							<div
								onpointerdown={(e) => {
									// Don't trigger if clicking on select dropdown
									if (e.target instanceof HTMLSelectElement) return;
									setRuntime(rt.key);
								}}
								class="flex cursor-pointer flex-col gap-3 rounded-lg border-2 bg-gray-900 p-4 transition-all select-none hover:bg-gray-800"
								class:border-gray-700={selectedRuntime !== rt.key}
								class:border-purple-600={selectedRuntime === rt.key}
								class:bg-gray-800={selectedRuntime === rt.key}
							>
								<div class="flex flex-col gap-1">
									<div class="font-medium">{rt.title}</div>
									<div class="text-sm text-gray-400">{rt.description}</div>
								</div>

								<!-- Kubernetes Context Selector -->
								{#if rt.key === 'grpc-k8s' && rt.contexts && rt.contexts.length > 0}
									<div class="flex flex-col gap-1.5" onclick={(e) => e.stopPropagation()}>
										<Select
											bind:value={selectedContext}
											options={rt.contexts.map((ctx) => ({ value: ctx, label: ctx }))}
											onchange={handleContextChange}
											label="Kubernetes Context:"
											disabled={selectedRuntime !== rt.key}
											class="text-sm"
										/>
									</div>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			</div>
		</Panel>

		<!-- Deployment Status for K8s Runtime -->
		{#if selectedRuntime === 'grpc-k8s'}
			{#if checkingDeployment}
				<!-- Checking Deployment Status -->
				<div
					class="flex items-center justify-center gap-4 rounded-lg border border-gray-700 bg-gray-900/50 p-8"
				>
					<Spinner />
					<div class="text-gray-400">Checking Inspektor Gadget deployment status...</div>
				</div>
			{:else if deploymentStatus?.deployed}
				<!-- IG Detected -->
				<div
					class="flex flex-col justify-between gap-4 rounded-lg border border-green-800/50 bg-green-900/10 p-4 md:flex-row"
				>
					<div class="flex gap-3">
						<div class="text-green-400">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="2"
								stroke="currentColor"
								class="h-6 w-6"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						</div>
						<div class="flex-1">
							<h3 class="font-semibold text-green-400">Inspektor Gadget Detected</h3>
							<div class="mt-1 flex flex-col gap-1 text-sm text-gray-400">
								<p>Inspektor Gadget is deployed and ready to use.</p>
								<div class="mt-1 flex gap-4 text-xs">
									<span>
										<span class="text-gray-500">Namespace:</span>
										<span class="font-mono text-green-400">{deploymentStatus.namespace}</span>
									</span>
									{#if deploymentStatus.version}
										<span>
											<span class="text-gray-500">Version:</span>
											<span class="font-mono text-green-400">{deploymentStatus.version}</span>
										</span>
									{/if}
								</div>
							</div>
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<button
							onclick={openRedeployModal}
							class="flex items-center justify-center gap-2 rounded-lg border border-purple-600 bg-purple-900/20 px-4 py-2.5 text-sm text-purple-400 transition-all hover:bg-purple-900/50"
						>
							<span>{@html Refresh}</span>
							<span>Redeploy Inspektor Gadget</span>
						</button>
						<button
							onclick={openUndeployModal}
							class="flex items-center justify-center gap-2 rounded-lg border border-red-600 bg-red-900/20 px-4 py-2.5 text-sm text-red-400 transition-all hover:bg-red-900/50"
						>
							<span>{@html Trash}</span>
							<span>Undeploy Inspektor Gadget</span>
						</button>
					</div>
				</div>
			{:else}
				<!-- IG Not Detected -->
				<div class="flex flex-col gap-4 rounded-lg border border-blue-800/50 bg-blue-900/10 p-4">
					<div class="flex items-start gap-3">
						<div class="text-blue-400">{@html Info}</div>
						<div class="flex-1">
							<h3 class="font-semibold text-blue-400">Inspektor Gadget Not Detected</h3>
							<p class="mt-1 text-sm text-gray-400">
								Inspektor Gadget does not appear to be deployed in your Kubernetes cluster. You can
								deploy it now using the official Helm chart.
							</p>
							{#if deploymentStatus?.error}
								<p class="mt-2 text-xs text-red-400">
									Note: {deploymentStatus.error}
								</p>
							{/if}
						</div>
					</div>
					<button
						onclick={openDeployModal}
						class="flex items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 py-2.5 text-sm text-white transition-all hover:bg-blue-700"
					>
						<span>{@html Server}</span>
						<span>Deploy Inspektor Gadget</span>
					</button>
				</div>
			{/if}
		{/if}

		{#if runtimeParams && runtimeParams.length > 0}
			<Panel title="Configuration" icon={Adjustments} color="gray">
				<Params params={runtimeParams} {values} />
			</Panel>
		{/if}
	</div>
</div>

<!-- K8s Deploy Modal -->
<K8sDeployModal
	open={deployModalOpen}
	onClose={closeDeployModal}
	redeploy={isRedeploy}
	undeploy={isUndeploy}
	kubeContext={selectedContext}
/>

<div class="flex flex-row justify-between bg-gray-950 p-4">
	<div></div>
	<div>
		<button
			disabled={!validated}
			class="flex cursor-pointer flex-row gap-2 rounded bg-green-800 px-4 py-2 hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-950 disabled:text-gray-500"
			onclick={createEnvironment}
		>
			<span>{@html Plus}</span>
			<span>Create Environment</span>
		</button>
	</div>
</div>
