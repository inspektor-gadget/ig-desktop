<script lang="ts">
	import { untrack } from 'svelte';
	import Input from '$lib/components/forms/Input.svelte';
	import Select from '$lib/components/forms/Select.svelte';
	import Toggle from '$lib/components/forms/Toggle.svelte';
	import Trash from '$lib/icons/trash.svg?raw';
	import Plus from '$lib/icons/plus.svg?raw';
	import Edit from '$lib/icons/pencil.svg?raw';

	/**
	 * Configuration for a single OpenTelemetry exporter
	 * Some fields are specific to certain exporter types (e.g., metrics)
	 */
	export interface OtelExporterConfig {
		exporter: string;
		endpoint: string;
		insecure: boolean;
		// Logs-specific
		compression?: string;
		// Metrics-specific
		temporality?: string;
		interval?: string;
		collectGoMetrics?: boolean;
		collectIGMetrics?: boolean;
	}

	/**
	 * Map of exporter name to configuration
	 */
	export type OtelExportersMap = Record<string, OtelExporterConfig>;

	interface Props {
		/** Whether the modal is open */
		open: boolean;
		/** Close handler */
		onClose: () => void;
		/** Save handler - receives the updated exporters map */
		onSave: (exporters: OtelExportersMap) => void;
		/** The type of exporters (logs, metrics, traces) - used for display */
		exporterType: 'logs' | 'metrics' | 'traces';
		/** Initial exporters configuration */
		initialExporters?: OtelExportersMap;
	}

	let {
		open = $bindable(false),
		onClose,
		onSave,
		exporterType,
		initialExporters = {}
	}: Props = $props();

	// Available options
	const exporterOptions = [{ value: 'otlp-grpc', label: 'OTLP gRPC' }];
	const compressionOptions = [
		{ value: 'gzip', label: 'gzip' },
		{ value: 'none', label: 'None' }
	];
	const temporalityOptions = [
		{ value: 'delta', label: 'Delta' },
		{ value: 'cumulative', label: 'Cumulative' }
	];

	// Check if this is a metrics exporter
	const isMetrics = $derived(exporterType === 'metrics');

	// Local state for exporters
	let exporters = $state<OtelExportersMap>({});

	// Form modal state
	let formModalOpen = $state(false);
	let editingName = $state<string | null>(null);

	// Form state for add/edit - common fields
	let formName = $state('');
	let formExporter = $state('otlp-grpc');
	let formEndpoint = $state('');
	let formInsecure = $state(true);

	// Logs-specific form state
	let formCompression = $state('gzip');

	// Metrics-specific form state
	let formTemporality = $state('delta');
	let formInterval = $state('30s');
	let formCollectGoMetrics = $state(false);
	let formCollectIGMetrics = $state(false);

	// Validation
	const formValid = $derived(
		formName.trim().length > 0 &&
			formEndpoint.trim().length > 0 &&
			// Name must be unique (unless editing the same one)
			(editingName === formName || !exporters[formName.trim()])
	);

	// Initialize exporters when modal opens
	// Use untrack to prevent re-running when initialExporters changes while modal is open
	$effect(() => {
		if (open) {
			// Deep clone to avoid mutating the original
			// untrack prevents this effect from re-running when initialExporters changes
			const initial = untrack(() => initialExporters);
			exporters = JSON.parse(JSON.stringify(initial || {}));
		}
	});

	function resetForm() {
		editingName = null;
		formName = '';
		formExporter = 'otlp-grpc';
		formEndpoint = '';
		formInsecure = true;
		// Logs-specific
		formCompression = 'gzip';
		// Metrics-specific
		formTemporality = 'delta';
		formInterval = '30s';
		formCollectGoMetrics = false;
		formCollectIGMetrics = false;
	}

	function openAddForm() {
		resetForm();
		formModalOpen = true;
	}

	function openEditForm(name: string) {
		const config = exporters[name];
		if (!config) return;

		editingName = name;
		formName = name;
		formExporter = config.exporter || 'otlp-grpc';
		formEndpoint = config.endpoint || '';
		formInsecure = config.insecure ?? true;
		// Logs-specific
		formCompression = config.compression || 'gzip';
		// Metrics-specific
		formTemporality = config.temporality || 'delta';
		formInterval = config.interval || '30s';
		formCollectGoMetrics = config.collectGoMetrics ?? false;
		formCollectIGMetrics = config.collectIGMetrics ?? false;
		formModalOpen = true;
	}

	function closeFormModal() {
		formModalOpen = false;
		resetForm();
	}

	function saveExporter() {
		if (!formValid) return;

		const name = formName.trim();
		const config: OtelExporterConfig = {
			exporter: formExporter,
			endpoint: formEndpoint.trim(),
			insecure: formInsecure
		};

		// Add type-specific fields
		if (isMetrics) {
			config.temporality = formTemporality;
			config.interval = formInterval;
			config.collectGoMetrics = formCollectGoMetrics;
			config.collectIGMetrics = formCollectIGMetrics;
		} else {
			config.compression = formCompression;
		}

		// If editing and name changed, remove old entry
		if (editingName && editingName !== name) {
			delete exporters[editingName];
		}

		exporters[name] = config;
		// Trigger reactivity
		exporters = { ...exporters };
		closeFormModal();
	}

	function deleteExporter(name: string) {
		delete exporters[name];
		// Trigger reactivity
		exporters = { ...exporters };
	}

	function handleSave() {
		onSave(exporters);
		onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	function handleFormBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			closeFormModal();
		}
	}

	function handleFormKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			closeFormModal();
		}
	}

	// Type label for display
	const typeLabel = $derived(
		exporterType === 'logs' ? 'Log' : exporterType === 'metrics' ? 'Metric' : 'Trace'
	);
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 text-gray-900 dark:text-white"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="otel-modal-title"
		tabindex="-1"
	>
		<!-- Stop propagation to prevent backdrop click from closing modal -->
		<div
			class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<!-- Modal Header -->
			<div class="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-6 py-4">
				<h2 id="otel-modal-title" class="text-lg font-semibold">
					OpenTelemetry {typeLabel} Exporters
				</h2>
				<button
					onclick={() => onClose()}
					class="cursor-pointer rounded p-1 text-gray-500 dark:text-gray-500 transition-all hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200"
					title="Close"
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
				<div class="flex flex-col gap-4">
					<!-- Existing Exporters List -->
					{#if Object.keys(exporters).length > 0}
						<div class="flex flex-col gap-2">
							{#each Object.entries(exporters) as [name, config] (name)}
								<div
									class="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-4 py-3"
								>
									<div class="flex flex-col gap-1">
										<span class="font-medium text-gray-800 dark:text-gray-200">{name}</span>
										<span class="text-xs text-gray-500 dark:text-gray-500">
											{config.exporter} → {config.endpoint}
											{#if config.insecure}
												<span class="text-yellow-600 dark:text-yellow-500">(insecure)</span>
											{/if}
											{#if isMetrics && config.interval}
												<span class="text-blue-600 dark:text-blue-400">every {config.interval}</span>
											{/if}
										</span>
									</div>
									<div class="flex items-center gap-2">
										<button
											onclick={() => openEditForm(name)}
											class="cursor-pointer rounded p-1.5 text-gray-500 dark:text-gray-400 transition-all hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400"
											title="Edit"
										>
											{@html Edit}
										</button>
										<button
											onclick={() => deleteExporter(name)}
											class="cursor-pointer rounded p-1.5 text-gray-500 dark:text-gray-400 transition-all hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-red-600 dark:hover:text-red-400"
											title="Delete"
										>
											{@html Trash}
										</button>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 p-6 text-center">
							<p class="text-sm text-gray-500 dark:text-gray-500">No {typeLabel.toLowerCase()} exporters configured</p>
						</div>
					{/if}

					<!-- Add Button -->
					<button
						onclick={openAddForm}
						class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm text-gray-500 dark:text-gray-400 transition-all hover:border-blue-500/50 hover:bg-gray-100 dark:hover:bg-gray-900/50 hover:text-blue-600 dark:hover:text-blue-400"
					>
						<span class="h-4 w-4">{@html Plus}</span>
						<span>Add {typeLabel} Exporter</span>
					</button>
				</div>
			</div>

			<!-- Modal Footer -->
			<div
				class="flex items-center justify-end gap-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-6 py-4"
			>
				<button
					onclick={() => onClose()}
					class="cursor-pointer rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 transition-all hover:border-gray-400 dark:hover:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-800"
				>
					Cancel
				</button>
				<button
					onclick={handleSave}
					class="cursor-pointer rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-all hover:bg-green-500"
				>
					Save Changes
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Nested Form Modal for Add/Edit -->
{#if formModalOpen}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 text-gray-900 dark:text-white"
		onclick={handleFormBackdropClick}
		onkeydown={handleFormKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="form-modal-title"
		tabindex="-1"
	>
		<div
			class="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<!-- Form Modal Header -->
			<div
				class="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-5 py-3"
			>
				<h3 id="form-modal-title" class="text-base font-semibold">
					{editingName ? `Edit "${editingName}"` : `Add ${typeLabel} Exporter`}
				</h3>
				<button
					onclick={closeFormModal}
					class="cursor-pointer rounded p-1 text-gray-500 dark:text-gray-500 transition-all hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200"
					title="Close"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="2"
						stroke="currentColor"
						class="h-4 w-4"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Form Modal Body -->
			<div class="flex-1 overflow-y-auto p-5">
				<div class="flex flex-col gap-4">
					<Input
						bind:value={formName}
						label="Exporter Name"
						placeholder={isMetrics ? 'my-metrics-exporter' : 'my-log-exporter'}
						description="Unique identifier for this exporter"
					/>

					<Select
						bind:value={formExporter}
						options={exporterOptions}
						label="Exporter Type"
						description="The protocol to use for exporting telemetry data"
					/>

					<Input
						bind:value={formEndpoint}
						label="Endpoint"
						placeholder="127.0.0.1:4317"
						description="The address of the OpenTelemetry collector"
					/>

					<Toggle
						bind:checked={formInsecure}
						label="Insecure Connection"
						description="Use insecure connection (no TLS)"
					/>

					{#if isMetrics}
						<!-- Metrics-specific fields -->
						<Select
							bind:value={formTemporality}
							options={temporalityOptions}
							label="Temporality"
							description="How metric values are reported over time"
						/>

						<Input
							bind:value={formInterval}
							label="Interval"
							placeholder="30s"
							description="How often metrics are exported (e.g., 30s, 1m)"
						/>

						<Toggle
							bind:checked={formCollectGoMetrics}
							label="Collect Go Metrics"
							description="Collect Go runtime metrics from the Inspektor Gadget process"
						/>

						<Toggle
							bind:checked={formCollectIGMetrics}
							label="Collect Inspektor Gadget Metrics"
							description="Collect Inspektor Gadget internal metrics"
						/>
					{:else}
						<!-- Logs-specific fields -->
						<Select
							bind:value={formCompression}
							options={compressionOptions}
							label="Compression"
							description="Compression algorithm for exported data"
						/>
					{/if}
				</div>
			</div>

			<!-- Form Modal Footer -->
			<div
				class="flex items-center justify-end gap-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-5 py-3"
			>
				<button
					onclick={closeFormModal}
					class="cursor-pointer rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 transition-all hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={saveExporter}
					disabled={!formValid}
					class="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{editingName ? 'Update' : 'Add'} Exporter
				</button>
			</div>
		</div>
	</div>
{/if}
