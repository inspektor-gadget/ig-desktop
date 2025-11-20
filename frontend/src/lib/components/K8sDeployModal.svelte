<script lang="ts">
	import { getContext } from 'svelte';
	import { deployments } from '$lib/shared/deployments.svelte';
	import type { DeploymentConfig } from '$lib/types';
	import Spinner from '$lib/components/Spinner.svelte';
	import Server from '$lib/icons/server.svg?raw';
	import Play from '$lib/icons/play-circle.svg?raw';
	import ExclamationCircle from '$lib/icons/close-circle.svg?raw';
	import Certificate from '$lib/icons/certificate.svg?raw';
	import ChevronDown from '$lib/icons/chevron-down.svg?raw';
	import Input from '$lib/components/forms/Input.svelte';
	import Textarea from '$lib/components/forms/Textarea.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		deploymentId?: string;
		redeploy?: boolean;
		undeploy?: boolean;
		kubeContext?: string;
	}

	let {
		open = $bindable(false),
		onClose,
		deploymentId,
		redeploy = false,
		undeploy = false,
		kubeContext = ''
	}: Props = $props();

	const api: any = getContext('api');

	// Form state
	let namespace = $state('gadget');
	let releaseName = $state('gadget');
	let chartVersion = $state('');
	let customValues = $state('');
	let showAdvanced = $state(false);
	let showDebugConsole = $state(false);

	// Deployment state - use a snapshot to avoid deep reactivity issues
	const currentDeployment = $derived(
		deploymentId ? deployments.get(deploymentId) : deployments.getActive()
	);
	const isDeploying = $derived(currentDeployment?.status === 'deploying');
	const isConfiguring = $derived(!currentDeployment || currentDeployment.status === 'configuring');
	const hasError = $derived(currentDeployment?.status === 'error');
	const isSuccess = $derived(currentDeployment?.status === 'success');

	// Validation
	let isValid = $derived(
		namespace.trim().length > 0 && releaseName.trim().length > 0 && !isDeploying
	);

	async function startDeployment() {
		if (!isValid) return;

		try {
			const config: DeploymentConfig = {
				namespace: namespace.trim(),
				releaseName: releaseName.trim(),
				chartVersion: chartVersion.trim() || undefined,
				customValues: customValues.trim() || undefined,
				kubeContext: kubeContext || undefined
			};

			console.log(
				'[Deploy] Starting deployment with config:',
				config,
				'redeploy:',
				redeploy,
				'undeploy:',
				undeploy
			);

			// Start deployment via API - backend will generate the ID
			const res = await api.request({
				cmd: 'deployIG',
				data: { ...config, redeploy, undeploy }
			});

			console.log('[Deploy] Backend response:', res);

			// Backend returns the deploymentId
			if (!res.deploymentId) {
				throw new Error('Backend did not return deploymentId');
			}

			const backendId = res.deploymentId;
			deploymentId = backendId;

			// Create deployment in store with backend's ID
			const tempDeployment = deployments.create(config);
			// Remove temp deployment and create with correct ID
			deployments.remove(tempDeployment);

			// Manually create with backend ID
			deployments.deployments[backendId] = {
				id: backendId,
				status: 'deploying',
				config,
				progress: 0,
				logs: [],
				debugLogs: [
					`[Frontend] Deployment started with ID: ${backendId}`,
					`[Frontend] Config: ${JSON.stringify(config, null, 2)}`,
					'[Frontend] Waiting for backend progress updates...'
				],
				timestamp: Date.now()
			};

			console.log('[Deploy] Created deployment in store with ID:', backendId);
		} catch (err) {
			console.error('Failed to start deployment:', err);
			const errorMsg = err instanceof Error ? err.message : String(err);

			// If we have a deploymentId, update it with error
			if (deploymentId) {
				deployments.update(deploymentId, {
					status: 'error',
					error: errorMsg
				});
				deployments.addDebugLog(deploymentId, `[Frontend] ERROR: ${errorMsg}`);
			}
		}
	}

	function closeModal(force = false) {
		// Always allow closing with force flag (e.g., from X button)
		if (!force && isDeploying) {
			if (
				!confirm(
					'Deployment is in progress. You can return to this modal later. Are you sure you want to close?'
				)
			) {
				return;
			}
		}

		// Clean up completed deployment from state when closing success modal
		if (isSuccess && deploymentId) {
			deployments.remove(deploymentId);
		}

		open = false;
		onClose?.();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			closeModal();
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 text-white"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-labelledby="deploy-modal-title"
	>
		<div
			class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950"
		>
			<!-- Modal Header -->
			<div class="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-4">
				<div class="flex items-center gap-3">
					<div class:text-blue-400={!undeploy} class:text-red-400={undeploy}>{@html Server}</div>
					<h2 id="deploy-modal-title" class="text-lg font-semibold">
						{undeploy ? 'Undeploy' : redeploy ? 'Redeploy' : 'Deploy'} Inspektor Gadget
						{undeploy ? 'from' : 'to'} Kubernetes
					</h2>
				</div>
				<button
					onclick={() => closeModal(true)}
					class="cursor-pointer rounded p-1 text-gray-500 transition-all hover:bg-gray-800 hover:text-gray-200"
					title="Close (Force)"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="2"
						stroke="currentColor"
						class="h-5 w-5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Modal Body -->
			<div class="flex-1 overflow-y-auto p-6">
				{#if isConfiguring}
					<!-- Configuration Form -->
					<div class="flex flex-col gap-6">
						<p class="text-sm text-gray-400">
							{#if undeploy}
								Configure the undeployment for Inspektor Gadget. The existing deployment will be
								completely removed from your cluster.
							{:else if redeploy}
								Configure the redeployment for Inspektor Gadget. The existing deployment will be
								uninstalled first, then reinstalled using the official Inspektor Gadget Helm chart.
							{:else}
								Configure the Helm deployment for Inspektor Gadget. The deployment will be performed
								using the official Inspektor Gadget Helm chart.
							{/if}
						</p>

						<!-- Namespace -->
						<Input
							bind:value={namespace}
							label="Namespace"
							placeholder="gadget"
							description="The Kubernetes namespace where Inspektor Gadget will be deployed"
						/>

						<!-- Release Name -->
						<Input
							bind:value={releaseName}
							label="Release Name"
							placeholder="gadget"
							description="The Helm release name for this installation"
						/>

						<!-- Chart Version -->
						<Input
							bind:value={chartVersion}
							label="Chart Version (Optional)"
							placeholder="latest"
							description="Leave empty to use the latest version, or specify a version like '0.43.0'"
						/>

						<!-- Advanced Options Toggle -->
						<button
							onclick={() => (showAdvanced = !showAdvanced)}
							class="flex items-center gap-2 text-sm text-blue-400 transition-all hover:text-blue-300"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="2"
								stroke="currentColor"
								class="h-4 w-4 transition-transform"
								class:rotate-90={showAdvanced}
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
							</svg>
							<span>Advanced Options</span>
						</button>

						{#if showAdvanced}
							<Textarea
								bind:value={customValues}
								label="Custom Values (YAML)"
								placeholder="key: value&#13;&#10;nested:&#13;&#10;  key: value"
								rows={6}
								description="Custom Helm values in YAML format to override default chart values"
								class="font-mono text-sm"
							/>
						{/if}

						<!-- Deploy Button -->
						<button
							disabled={!isValid}
							onclick={startDeployment}
							class="flex cursor-pointer items-center justify-center gap-2 rounded-lg px-6 py-3 text-white transition-all disabled:cursor-not-allowed disabled:text-gray-500"
							class:bg-green-800={!undeploy}
							class:hover:bg-green-700={!undeploy}
							class:disabled:bg-green-950={!undeploy}
							class:bg-red-800={undeploy}
							class:hover:bg-red-700={undeploy}
							class:disabled:bg-red-950={undeploy}
						>
							<span>{@html Play}</span>
							<span>{undeploy ? 'Undeploy' : redeploy ? 'Redeploy' : 'Deploy'}</span>
						</button>
					</div>
				{:else if isDeploying}
					<!-- Deployment Progress -->
					<div class="flex flex-col gap-6">
						<div class="flex flex-col items-center gap-4">
							<Spinner />
							<div class="text-center">
								<div class="text-lg font-semibold">
									{undeploy ? 'Undeploying' : redeploy ? 'Redeploying' : 'Deploying'} Inspektor Gadget
								</div>
								<div class="text-sm text-gray-400">
									{currentDeployment?.currentStep || 'Initializing...'}
								</div>
							</div>
						</div>

						<!-- Progress Bar -->
						<div class="flex flex-col gap-2">
							<div class="flex items-center justify-between text-sm">
								<span class="text-gray-400">Progress</span>
								<span class="font-semibold text-blue-400">
									{currentDeployment?.progress || 0}%
								</span>
							</div>
							<div class="h-2 overflow-hidden rounded-full bg-gray-800">
								<div
									class="h-full bg-blue-500 transition-all duration-500"
									style="width: {currentDeployment?.progress || 0}%"
								></div>
							</div>
						</div>

						<!-- Debug Console Toggle -->
						<button
							onclick={() => (showDebugConsole = !showDebugConsole)}
							class="flex items-center gap-2 text-sm text-gray-400 transition-all hover:text-gray-300"
						>
							<div class="transition-transform duration-200" class:rotate-180={showDebugConsole}>
								{@html ChevronDown}
							</div>
							<span>Output Console ({currentDeployment?.debugLogs?.length || 0} entries)</span>
						</button>

						<!-- Debug Console -->
						{#if showDebugConsole && currentDeployment?.debugLogs && currentDeployment.debugLogs.length > 0}
							<div class="flex flex-col gap-2">
								<div
									class="max-h-64 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-3 font-mono text-xs"
								>
									{#each currentDeployment.debugLogs as log}
										<div class="text-gray-400">{log}</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Deployment Logs -->
						{#if currentDeployment?.logs && currentDeployment.logs.length > 0}
							<div class="flex flex-col gap-2">
								<label class="text-sm font-semibold tracking-wide text-gray-500 uppercase">
									Deployment Logs
								</label>
								<div
									class="max-h-64 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/50 p-4 font-mono text-xs"
								>
									{#each currentDeployment.logs as log}
										<div class="text-gray-400">{log}</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{:else if hasError}
					<!-- Error State -->
					<div class="flex flex-col items-center gap-4 text-center">
						<div class="text-red-400">{@html ExclamationCircle}</div>
						<div>
							<h3 class="text-lg font-semibold text-red-400">Deployment Failed</h3>
							<p class="mt-2 text-sm text-gray-400">
								{currentDeployment?.error || 'An unknown error occurred'}
							</p>
						</div>

						<!-- Error Logs -->
						{#if currentDeployment?.logs && currentDeployment.logs.length > 0}
							<div class="w-full">
								<div
									class="max-h-48 overflow-y-auto rounded-lg border border-red-800/50 bg-red-900/10 p-4 text-left font-mono text-xs"
								>
									{#each currentDeployment.logs as log}
										<div class="text-gray-400">{log}</div>
									{/each}
								</div>
							</div>
						{/if}

						<button
							onclick={() => {
								if (deploymentId) deployments.remove(deploymentId);
								deploymentId = undefined;
							}}
							class="mt-4 rounded-lg border border-gray-800 bg-gray-900/50 px-6 py-2 transition-all hover:border-blue-500/50 hover:bg-gray-900"
						>
							Try Again
						</button>
					</div>
				{:else if isSuccess}
					<!-- Success State -->
					<div class="flex flex-col items-center gap-4 text-center">
						<div class:text-green-400={!undeploy} class:text-red-400={undeploy}>
							{@html Certificate}
						</div>
						<div>
							<h3
								class="text-lg font-semibold"
								class:text-green-400={!undeploy}
								class:text-red-400={undeploy}
							>
								{undeploy ? 'Undeployment' : redeploy ? 'Redeployment' : 'Deployment'} Successful!
							</h3>
							<p class="mt-2 text-sm text-gray-400">
								Inspektor Gadget has been successfully {undeploy
									? 'undeployed from'
									: redeploy
										? 'redeployed to'
										: 'deployed to'} namespace
								<span class="font-mono text-blue-400">{currentDeployment?.config.namespace}</span>
							</p>
						</div>

						<button
							onclick={() => closeModal()}
							class="mt-4 rounded-lg bg-green-800 px-6 py-3 text-white transition-all hover:bg-green-700"
						>
							Continue
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
