<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import WizardTargets from './WizardTargets.svelte';
	import {
		getGadgetSpecs,
		getEndpointGadgetNames,
		type WizardEndpointNode,
		type WizardTargetParams,
		type WizardTreeConfig
	} from './wizard-types';
	import type { Environment, GadgetRunRequest } from '$lib/types';

	import PlaySmall from '$lib/icons/fa/play.svg?raw';
	import CogSmall from '$lib/icons/cog-small.svg?raw';
	import ChevronDown from '$lib/icons/chevron-down.svg?raw';
	// Note: Breadcrumbs and back navigation are handled by parent GadgetWizard

	interface Props {
		node: WizardEndpointNode;
		nodeId: string;
		env: Environment;
		treeConfig: WizardTreeConfig;
		detached: boolean;
		onRun: (request: GadgetRunRequest) => Promise<void>;
	}

	let { node, nodeId, env, treeConfig, detached, onRun }: Props = $props();

	// Target parameters state
	let targetParams = $state<WizardTargetParams>({});

	// Target filters collapse state - remembered per endpoint
	const STORAGE_KEY = 'wizard-filters-expanded';
	let filtersExpanded = $state(false);

	// localStorage helpers for filter expanded state
	function getFilterExpanded(id: string): boolean {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				const expandedMap = JSON.parse(stored) as Record<string, boolean>;
				return expandedMap[id] ?? false;
			}
		} catch {
			// Ignore localStorage errors
		}
		return false;
	}

	function setFilterExpanded(id: string, expanded: boolean): void {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			const expandedMap = stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
			expandedMap[id] = expanded;
			localStorage.setItem(STORAGE_KEY, JSON.stringify(expandedMap));
		} catch {
			// Ignore localStorage errors
		}
	}

	// Load expanded state when nodeId changes
	$effect(() => {
		filtersExpanded = getFilterExpanded(nodeId);
	});

	// Toggle and persist filter visibility
	function toggleFilters() {
		filtersExpanded = !filtersExpanded;
		setFilterExpanded(nodeId, filtersExpanded);
	}

	// Detect environment type
	const isKubernetes = $derived(env.runtime === 'grpc-k8s');

	// Get normalized gadget specs and names for display
	const gadgetSpecs = $derived(getGadgetSpecs(node));
	const gadgetNames = $derived(getEndpointGadgetNames(node));
	const hasMultipleGadgets = $derived(gadgetSpecs.length > 1);

	// Build filter params with proper operator prefixes
	function buildFilterParams(): Record<string, unknown> {
		const params: Record<string, unknown> = {};

		if (isKubernetes) {
			if (targetParams.namespace) {
				params['operator.filter.namespace'] = targetParams.namespace;
			}
			if (targetParams.pod) {
				params['operator.filter.podname'] = targetParams.pod;
			}
			if (targetParams.labels) {
				params['operator.filter.labels'] = targetParams.labels;
			}
		} else {
			if (targetParams.containername) {
				params['operator.filter.containername'] = targetParams.containername;
			}
			if (targetParams.host) {
				params['operator.LocalManager.host'] = 'true';
			}
		}

		return params;
	}

	// Build GadgetRunRequest for a specific gadget spec
	function buildRequest(specIndex = 0): GadgetRunRequest {
		const spec = gadgetSpecs[specIndex];
		if (!spec) {
			throw new Error('No gadget spec found at index ' + specIndex);
		}
		const filterParams = buildFilterParams();

		return {
			image: treeConfig.gadgetPrefix + spec.gadget,
			params: { ...spec.params, ...filterParams },
			detached,
			instanceName: detached ? spec.suggestedInstanceName : undefined,
			timestamp: Date.now()
		};
	}

	// Handle run directly - runs all gadgets sequentially
	async function handleRunNow() {
		for (let i = 0; i < gadgetSpecs.length; i++) {
			const request = buildRequest(i);
			await onRun(request);
		}
	}

	// Navigate to run gadget page with pre-filled params (first gadget only)
	function handleConfigure() {
		const spec = gadgetSpecs[0];
		if (!spec) return;

		const fullImage = treeConfig.gadgetPrefix + spec.gadget;
		const searchParams = new URLSearchParams();
		searchParams.set('env', env.id);

		const allParams = {
			...spec.params,
			...buildFilterParams()
		};

		if (Object.keys(allParams).length > 0) {
			searchParams.set('params', JSON.stringify(allParams));
		}

		searchParams.set('detached', String(detached));

		if (detached && spec.suggestedInstanceName) {
			searchParams.set('instanceName', spec.suggestedInstanceName);
		}

		goto(resolve(`/gadgets/run/${fullImage}?${searchParams.toString()}`));
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Gadget info -->
	<div class="flex flex-col gap-2">
		<h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200">{node.label}</h3>
		{#if node.description}
			<p class="text-sm text-gray-600 dark:text-gray-400">{node.description}</p>
		{/if}
		<!-- Gadget tags -->
		<div class="flex flex-wrap gap-1.5">
			{#each gadgetNames as name (name)}
				<span
					class="rounded border border-orange-300/50 dark:border-orange-700/50 bg-orange-100/50 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-mono text-orange-700 dark:text-orange-400"
				>
					{name}
				</span>
			{/each}
		</div>
	</div>

	<!-- Detached mode indicator -->
	{#if detached}
		<div
			class="rounded-lg border border-blue-300/50 dark:border-blue-800/50 bg-blue-100/20 dark:bg-blue-900/20 p-3 text-sm text-blue-700 dark:text-blue-300"
		>
			{#if hasMultipleGadgets}
				This will create {gadgetSpecs.length} headless instances
			{:else}
				This will create a headless instance named <span class="font-mono font-medium"
					>{gadgetSpecs[0]?.suggestedInstanceName || 'unnamed'}</span
				>
			{/if}
		</div>
	{/if}

	<!-- Target filters section (collapsible) -->
	<div class="flex flex-col gap-3">
		<button
			onclick={toggleFilters}
			class="flex cursor-pointer items-center gap-1 text-sm font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
		>
			<span
				class="size-4 transition-transform duration-200 [&>svg]:size-4 [&>svg]:!text-inherit"
				class:rotate-0={filtersExpanded}
				class:-rotate-90={!filtersExpanded}
			>
				{@html ChevronDown}
			</span>
			<span>Target Filters</span>
		</button>
		{#if filtersExpanded}
			<WizardTargets {isKubernetes} bind:params={targetParams} environmentID={env.id} />
		{/if}
	</div>

	<!-- Action buttons -->
	<div class="flex flex-row items-center justify-end gap-2 pt-2">
		<button
			onclick={handleConfigure}
			class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/50 dark:bg-gray-900/50 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 transition-all hover:border-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900"
			title={hasMultipleGadgets
				? 'Configure first gadget with more options'
				: 'Configure and run with more options'}
		>
			<span>{@html CogSmall}</span>
			<span>Configure{hasMultipleGadgets ? ` (${gadgetNames[0]})` : ''}</span>
		</button>
		<button
			onclick={handleRunNow}
			class="flex cursor-pointer items-center gap-2 rounded-lg border border-orange-300 dark:border-orange-800 bg-orange-100/20 dark:bg-orange-900/20 px-4 py-2 text-sm text-orange-600 dark:text-orange-400 transition-all hover:border-orange-500/50 hover:bg-orange-100/40 dark:hover:bg-orange-900/40"
		>
			<span>{@html PlaySmall}</span>
			<span>
				{#if hasMultipleGadgets}
					{detached
						? `Create ${gadgetSpecs.length} Instances`
						: `Run ${gadgetSpecs.length} Gadgets`}
				{:else}
					{detached ? 'Create Instance' : 'Run Now'}
				{/if}
			</span>
		</button>
	</div>
</div>
