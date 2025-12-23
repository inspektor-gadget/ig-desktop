<script lang="ts">
	import { getContext } from 'svelte';
	import yaml from 'js-yaml';
	import { deployments } from '$lib/shared/deployments.svelte';
	import type { DeploymentConfig } from '$lib/types';
	import Spinner from '$lib/components/Spinner.svelte';
	import Server from '$lib/icons/server.svg?raw';
	import Play from '$lib/icons/play-circle.svg?raw';
	import ExclamationCircle from '$lib/icons/close-circle.svg?raw';
	import Certificate from '$lib/icons/certificate.svg?raw';
	import ChevronDown from '$lib/icons/chevron-down.svg?raw';
	import ChevronRight from '$lib/icons/chevron-right.svg?raw';
	import Input from '$lib/components/forms/Input.svelte';
	import Textarea from '$lib/components/forms/Textarea.svelte';
	import Toggle from '$lib/components/forms/Toggle.svelte';
	import OtelExportersModal, {
		type OtelExportersMap
	} from '$lib/components/OtelExportersModal.svelte';

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

	// Default address for Prometheus metrics endpoint
	const DEFAULT_METRICS_LISTEN_ADDRESS = '0.0.0.0:2224';

	// Form state
	let namespace = $state('gadget');
	let releaseName = $state('gadget');
	let chartVersion = $state('');
	let customValues = $state('');
	let showAdvanced = $state(false);
	let showDebugConsole = $state(false);
	let loadingChartValues = $state(false);
	let chartValuesLoaded = $state(false);
	let chartValuesError = $state<string | null>(null);

	// Parsed YAML values object for programmatic updates
	let valuesObject = $state<Record<string, any>>({});

	// UI-exposed settings derived from values
	let verifyImageSignatures = $state(false);

	// OpenTelemetry metrics settings
	let otelMetricsListen = $state(false);
	let otelMetricsListenAddress = $state(DEFAULT_METRICS_LISTEN_ADDRESS);

	// OpenTelemetry exporters modal state
	let otelLogsModalOpen = $state(false);
	let otelMetricsModalOpen = $state(false);

	// Get current otel-logs exporters from values
	const otelLogsExporters = $derived<OtelExportersMap>(
		(getNestedValue(valuesObject, 'config.operator.otel-logs.exporters') as OtelExportersMap) || {}
	);
	const otelLogsExporterCount = $derived(Object.keys(otelLogsExporters).length);

	// Get current otel-metrics exporters from values
	const otelMetricsExporters = $derived<OtelExportersMap>(
		(getNestedValue(valuesObject, 'config.operator.otel-metrics.exporters') as OtelExportersMap) ||
			{}
	);
	const otelMetricsExporterCount = $derived(Object.keys(otelMetricsExporters).length);

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

	// Helper to get nested value from object
	function getNestedValue(obj: Record<string, any>, path: string): any {
		const keys = path.split('.');
		let current = obj;
		for (const key of keys) {
			if (current === undefined || current === null) return undefined;
			current = current[key];
		}
		return current;
	}

	// Helper to set nested value in object (mutates the object)
	function setNestedValue(obj: Record<string, any>, path: string, value: any): void {
		const keys = path.split('.');
		let current = obj;
		for (let i = 0; i < keys.length - 1; i++) {
			const key = keys[i];
			if (current[key] === undefined || current[key] === null) {
				current[key] = {};
			}
			current = current[key];
		}
		current[keys[keys.length - 1]] = value;
	}

	// Parse YAML and extract UI values
	function parseValuesFromYaml(yamlStr: string): void {
		try {
			valuesObject = (yaml.load(yamlStr) as Record<string, any>) || {};
			// Extract UI-exposed values
			const verifyImage = getNestedValue(valuesObject, 'config.operator.oci.verify-image');
			verifyImageSignatures = verifyImage === true;

			// Extract OpenTelemetry metrics settings
			const metricsListen = getNestedValue(
				valuesObject,
				'config.operator.otel-metrics.otel-metrics-listen'
			);
			otelMetricsListen = metricsListen === true;

			const metricsListenAddr = getNestedValue(
				valuesObject,
				'config.operator.otel-metrics.otel-metrics-listen-address'
			);
			otelMetricsListenAddress = metricsListenAddr || DEFAULT_METRICS_LISTEN_ADDRESS;
		} catch (err) {
			console.error('Failed to parse YAML:', err);
			valuesObject = {};
		}
	}

	// Update YAML string from values object
	function updateYamlFromValues(): void {
		try {
			customValues = yaml.dump(valuesObject, { indent: 2, lineWidth: -1 });
		} catch (err) {
			console.error('Failed to serialize YAML:', err);
		}
	}

	// Update a specific value in the YAML
	function updateYamlValue(path: string, value: any): void {
		setNestedValue(valuesObject, path, value);
		// Trigger Svelte reactivity by reassigning the object
		valuesObject = { ...valuesObject };
		updateYamlFromValues();
	}

	// Handle verify image signatures toggle
	function handleVerifyImageChange(checked: boolean): void {
		verifyImageSignatures = checked;
		updateYamlValue('config.operator.oci.verify-image', checked);
	}

	// Handle OpenTelemetry metrics listen toggle
	function handleOtelMetricsListenChange(checked: boolean): void {
		otelMetricsListen = checked;
		updateYamlValue('config.operator.otel-metrics.otel-metrics-listen', checked);
	}

	// Handle OpenTelemetry metrics listen address change
	function handleOtelMetricsListenAddressChange(): void {
		updateYamlValue(
			'config.operator.otel-metrics.otel-metrics-listen-address',
			otelMetricsListenAddress.trim() || DEFAULT_METRICS_LISTEN_ADDRESS
		);
	}

	// Handle OpenTelemetry log exporters save
	function handleOtelLogsExportersSave(exporters: OtelExportersMap): void {
		if (Object.keys(exporters).length === 0) {
			// Remove the exporters key if empty
			const otelLogs = getNestedValue(valuesObject, 'config.operator.otel-logs');
			if (otelLogs && otelLogs.exporters) {
				delete otelLogs.exporters;
			}
			// Trigger Svelte reactivity
			valuesObject = { ...valuesObject };
			updateYamlFromValues();
		} else {
			updateYamlValue('config.operator.otel-logs.exporters', exporters);
		}
	}

	// Handle OpenTelemetry metrics exporters save
	function handleOtelMetricsExportersSave(exporters: OtelExportersMap): void {
		if (Object.keys(exporters).length === 0) {
			// Remove the exporters key if empty
			const otelMetrics = getNestedValue(valuesObject, 'config.operator.otel-metrics');
			if (otelMetrics && otelMetrics.exporters) {
				delete otelMetrics.exporters;
			}
			// Trigger Svelte reactivity
			valuesObject = { ...valuesObject };
			updateYamlFromValues();
		} else {
			updateYamlValue('config.operator.otel-metrics.exporters', exporters);
		}
	}

	// Handle manual YAML edits - re-parse to sync UI values
	function handleYamlChange(): void {
		parseValuesFromYaml(customValues);
	}

	async function fetchChartValues() {
		if (chartValuesLoaded || loadingChartValues) return;

		loadingChartValues = true;
		chartValuesError = null;

		try {
			const res = await api.request({
				cmd: 'getChartValues',
				data: { chartVersion: chartVersion.trim() || undefined }
			});

			if (res.values) {
				customValues = res.values;
				parseValuesFromYaml(res.values);
				chartValuesLoaded = true;
			}
		} catch (err) {
			console.error('Failed to fetch chart values:', err);
			chartValuesError = err instanceof Error ? err.message : String(err);
		} finally {
			loadingChartValues = false;
		}
	}

	// Fetch chart values when modal opens (not for undeploy)
	$effect(() => {
		if (open && !undeploy && !chartValuesLoaded && !loadingChartValues) {
			fetchChartValues();
		}
	});

	// Reset chart values state when chart version changes
	let previousChartVersion = $state('');
	$effect(() => {
		if (chartVersion !== previousChartVersion) {
			previousChartVersion = chartVersion;
			// Reset the loaded state so values can be refetched for new version
			if (chartValuesLoaded) {
				chartValuesLoaded = false;
				customValues = '';
				chartValuesError = null;
				valuesObject = {};
				verifyImageSignatures = false;
				// Fetch new values
				if (open && !undeploy) {
					fetchChartValues();
				}
			}
		}
	});

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
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 text-gray-900 dark:text-white"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && closeModal()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="deploy-modal-title"
		tabindex="-1"
	>
		<div
			class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950"
		>
			<!-- Modal Header -->
			<div
				class="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-6 py-4"
			>
				<div class="flex items-center gap-3">
					<div class:text-blue-400={!undeploy} class:text-red-400={undeploy}>{@html Server}</div>
					<h2 id="deploy-modal-title" class="text-lg font-semibold">
						{undeploy ? 'Undeploy' : redeploy ? 'Redeploy' : 'Deploy'} Inspektor Gadget
						{undeploy ? 'from' : 'to'} Kubernetes
					</h2>
				</div>
				<button
					onclick={() => closeModal(true)}
					class="cursor-pointer rounded p-1 text-gray-500 dark:text-gray-500 transition-all hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200"
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
						<p class="text-sm text-gray-600 dark:text-gray-400">
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

						{#if !undeploy}
							<!-- Chart Version -->
							<Input
								bind:value={chartVersion}
								label="Chart Version (Optional)"
								placeholder="latest"
								description="Leave empty to use the latest version, or specify a version like '0.43.0'"
							/>

							<!-- Loading indicator -->
							{#if loadingChartValues}
								<div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
									<Spinner />
									<span>Loading chart values...</span>
								</div>
							{/if}

							<!-- Chart values error -->
							{#if chartValuesError}
								<div
									class="rounded-lg border border-yellow-300 dark:border-yellow-800/50 bg-yellow-100 dark:bg-yellow-900/20 p-3 text-sm text-yellow-700 dark:text-yellow-400"
								>
									Failed to load chart values: {chartValuesError}
								</div>
							{/if}

							<!-- Exposed Settings -->
							{#if chartValuesLoaded}
								<div
									class="flex flex-col gap-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 p-4"
								>
									<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
										Configuration
									</h3>
									<Toggle
										checked={verifyImageSignatures}
										onchange={handleVerifyImageChange}
										label="Verify Image Signatures"
										description="Verify container image signatures using cosign"
									/>
								</div>

								<!-- OpenTelemetry Configuration -->
								<div
									class="flex flex-col gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 p-4"
								>
									<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
										OpenTelemetry
									</h3>
									<button
										onclick={() => (otelLogsModalOpen = true)}
										class="flex cursor-pointer items-center justify-between rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 px-4 py-3 text-left transition-all hover:border-blue-500/50 hover:bg-gray-200 dark:hover:bg-gray-800"
									>
										<div class="flex flex-col gap-0.5">
											<span class="text-sm font-medium text-gray-800 dark:text-gray-200"
												>Log Exporters</span
											>
											<span class="text-xs text-gray-500 dark:text-gray-500">
												{#if otelLogsExporterCount > 0}
													{otelLogsExporterCount} exporter{otelLogsExporterCount !== 1 ? 's' : ''} configured
												{:else}
													No exporters configured
												{/if}
											</span>
										</div>
										<span class="text-gray-500 dark:text-gray-400">{@html ChevronRight}</span>
									</button>
									<button
										onclick={() => (otelMetricsModalOpen = true)}
										class="flex cursor-pointer items-center justify-between rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 px-4 py-3 text-left transition-all hover:border-blue-500/50 hover:bg-gray-200 dark:hover:bg-gray-800"
									>
										<div class="flex flex-col gap-0.5">
											<span class="text-sm font-medium text-gray-800 dark:text-gray-200"
												>Metric Exporters</span
											>
											<span class="text-xs text-gray-500 dark:text-gray-500">
												{#if otelMetricsExporterCount > 0}
													{otelMetricsExporterCount} exporter{otelMetricsExporterCount !== 1
														? 's'
														: ''} configured
												{:else}
													No exporters configured
												{/if}
											</span>
										</div>
										<span class="text-gray-500 dark:text-gray-400">{@html ChevronRight}</span>
									</button>

									<!-- Prometheus Listener -->
									<div class="mt-2 border-t border-gray-200 dark:border-gray-800 pt-3">
										<Toggle
											checked={otelMetricsListen}
											onchange={handleOtelMetricsListenChange}
											label="Prometheus Listener"
											description="Enable the Prometheus-compatible metrics endpoint"
										/>
									</div>

									{#if otelMetricsListen}
										<Input
											bind:value={otelMetricsListenAddress}
											onblur={handleOtelMetricsListenAddressChange}
											label="Listen Address"
											placeholder="0.0.0.0:2224"
											description="Address and port for the Prometheus metrics endpoint"
										/>
									{/if}
								</div>
							{/if}

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
								<span>Advanced Options (YAML)</span>
							</button>

							{#if showAdvanced}
								<Textarea
									bind:value={customValues}
									onblur={handleYamlChange}
									label="Custom Values (YAML)"
									placeholder={loadingChartValues
										? 'Loading default values...'
										: 'key: value\nnested:\n  key: value'}
									rows={16}
									description="Full Helm values. Changes here will sync with the settings above."
									class="font-mono text-sm"
									disabled={loadingChartValues}
								/>
							{/if}
						{/if}

						<!-- Deploy Button -->
						<button
							disabled={!isValid}
							onclick={startDeployment}
							class="flex cursor-pointer items-center justify-center gap-2 rounded-lg px-6 py-3 text-white transition-all disabled:cursor-not-allowed disabled:text-gray-400 dark:disabled:text-gray-500"
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
								<div class="text-sm text-gray-600 dark:text-gray-400">
									{currentDeployment?.currentStep || 'Initializing...'}
								</div>
							</div>
						</div>

						<!-- Progress Bar -->
						<div class="flex flex-col gap-2">
							<div class="flex items-center justify-between text-sm">
								<span class="text-gray-600 dark:text-gray-400">Progress</span>
								<span class="font-semibold text-blue-600 dark:text-blue-400">
									{currentDeployment?.progress || 0}%
								</span>
							</div>
							<div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
								<div
									class="h-full bg-blue-500 transition-all duration-500"
									style="width: {currentDeployment?.progress || 0}%"
								></div>
							</div>
						</div>

						<!-- Debug Console Toggle -->
						<button
							onclick={() => (showDebugConsole = !showDebugConsole)}
							class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 transition-all hover:text-gray-700 dark:hover:text-gray-300"
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
									class="max-h-64 overflow-y-auto rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 font-mono text-xs"
								>
									{#each currentDeployment.debugLogs as log}
										<div class="text-gray-600 dark:text-gray-400">{log}</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Deployment Logs -->
						{#if currentDeployment?.logs && currentDeployment.logs.length > 0}
							<div class="flex flex-col gap-2">
								<span class="text-sm font-semibold tracking-wide text-gray-500 uppercase">
									Deployment Logs
								</span>
								<div
									class="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 p-4 font-mono text-xs"
								>
									{#each currentDeployment.logs as log}
										<div class="text-gray-600 dark:text-gray-400">{log}</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{:else if hasError}
					<!-- Error State -->
					<div class="flex flex-col items-center gap-4 text-center">
						<div class="text-red-500 dark:text-red-400">{@html ExclamationCircle}</div>
						<div>
							<h3 class="text-lg font-semibold text-red-500 dark:text-red-400">
								Deployment Failed
							</h3>
							<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
								{currentDeployment?.error || 'An unknown error occurred'}
							</p>
						</div>

						<!-- Error Logs -->
						{#if currentDeployment?.logs && currentDeployment.logs.length > 0}
							<div class="w-full">
								<div
									class="max-h-48 overflow-y-auto rounded-lg border border-red-300 dark:border-red-800/50 bg-red-50 dark:bg-red-900/10 p-4 text-left font-mono text-xs"
								>
									{#each currentDeployment.logs as log}
										<div class="text-gray-600 dark:text-gray-400">{log}</div>
									{/each}
								</div>
							</div>
						{/if}

						<button
							onclick={() => {
								if (deploymentId) deployments.remove(deploymentId);
								deploymentId = undefined;
							}}
							class="mt-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-6 py-2 transition-all hover:border-blue-500/50 hover:bg-gray-100 dark:hover:bg-gray-900"
						>
							Try Again
						</button>
					</div>
				{:else if isSuccess}
					<!-- Success State -->
					<div class="flex flex-col items-center gap-4 text-center">
						<div
							class:text-green-500={!undeploy}
							class:dark:text-green-400={!undeploy}
							class:text-red-500={undeploy}
							class:dark:text-red-400={undeploy}
						>
							{@html Certificate}
						</div>
						<div>
							<h3
								class="text-lg font-semibold"
								class:text-green-500={!undeploy}
								class:dark:text-green-400={!undeploy}
								class:text-red-500={undeploy}
								class:dark:text-red-400={undeploy}
							>
								{undeploy ? 'Undeployment' : redeploy ? 'Redeployment' : 'Deployment'} Successful!
							</h3>
							<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
								Inspektor Gadget has been successfully {undeploy
									? 'undeployed from'
									: redeploy
										? 'redeployed to'
										: 'deployed to'} namespace
								<span class="font-mono text-blue-600 dark:text-blue-400"
									>{currentDeployment?.config.namespace}</span
								>
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

<!-- OpenTelemetry Log Exporters Modal -->
<OtelExportersModal
	bind:open={otelLogsModalOpen}
	onClose={() => (otelLogsModalOpen = false)}
	onSave={handleOtelLogsExportersSave}
	exporterType="logs"
	initialExporters={otelLogsExporters}
/>

<!-- OpenTelemetry Metric Exporters Modal -->
<OtelExportersModal
	bind:open={otelMetricsModalOpen}
	onClose={() => (otelMetricsModalOpen = false)}
	onSave={handleOtelMetricsExportersSave}
	exporterType="metrics"
	initialExporters={otelMetricsExporters}
/>
