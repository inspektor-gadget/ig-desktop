<script lang="ts">
	import WizardBranch from './WizardBranch.svelte';
	import WizardEndpoint from './WizardEndpoint.svelte';
	import { isBranchNode, isEndpointNode, getNodeLabel } from './wizard-types';
	import type { WizardTreeConfig, WizardBranchNode, WizardEndpointNode } from './wizard-types';
	import type { Environment, GadgetRunRequest } from '$lib/types';

	import Gadget from '$lib/icons/gadget.svg?raw';
	import ChevronLeft from '$lib/icons/chevron-left.svg?raw';
	import Close from '$lib/icons/close-small.svg?raw';

	interface Props {
		treeConfig: WizardTreeConfig;
		env: Environment;
		onRun: (request: GadgetRunRequest) => Promise<void>;
		onHide: () => void;
	}

	let { treeConfig, env, onRun, onHide }: Props = $props();

	// Navigation state - stack of node IDs
	let navigationPath = $state<string[]>(['root']);

	// Current node ID is the last in the path
	const currentNodeId = $derived(navigationPath[navigationPath.length - 1]);

	// Current node
	const currentNode = $derived(treeConfig.nodes[currentNodeId]);

	// Determine if current node is branch or endpoint
	const isCurrentBranch = $derived(isBranchNode(currentNode));
	const isCurrentEndpoint = $derived(isEndpointNode(currentNode));

	// Whether we're at root
	const isAtRoot = $derived(navigationPath.length === 1);

	// Build title with breadcrumbs
	const panelTitle = $derived.by(() => {
		if (isAtRoot) return treeConfig.title;
		// Show breadcrumb path: "Gadget Wizard / Debug / Network"
		const crumbs = navigationPath.slice(1).map((nodeId) => getNodeLabel(treeConfig.nodes[nodeId]));
		return crumbs.join(' / ');
	});

	// Calculate inherited detached flag from ancestors
	const inheritedDetached = $derived.by(() => {
		for (const nodeId of navigationPath) {
			const node = treeConfig.nodes[nodeId];
			if (isBranchNode(node) && node.detached !== undefined) {
				return node.detached;
			}
		}
		return false;
	});

	// Check if we're in the telemetry branch (for showing the info banner)
	const showTelemetryNote = $derived(navigationPath.includes('telemetry'));

	// Navigate to a child node
	function navigateTo(nodeId: string) {
		navigationPath = [...navigationPath, nodeId];
	}

	// Go back one level
	function goBack() {
		if (navigationPath.length > 1) {
			navigationPath = navigationPath.slice(0, -1);
		}
	}

	// Reset to root
	function resetToRoot() {
		navigationPath = ['root'];
	}

	// Handle run - delegate to parent and reset
	async function handleRun(request: GadgetRunRequest) {
		await onRun(request);
		resetToRoot();
	}

	// Reset when environment changes
	$effect(() => {
		if (env?.id) {
			resetToRoot();
		}
	});
</script>

<div
	class="group main-gradient flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 transition-all hover:border-orange-500/50 shadow-sm hover:shadow-lg hover:shadow-orange-500/10 shadow-gray-200/90 dark:shadow-gray-950/90"
>
	<!-- Custom Header -->
	<div
		class="flex items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-gray-100/50 dark:border-gray-800 dark:bg-gray-900/50 px-6 py-4"
	>
		<div class="flex flex-1 items-center gap-3">
			<!-- Fixed-width container for icon/back button to keep title aligned -->
			<div class="flex size-6 items-center justify-center">
				{#if isAtRoot}
					<!-- At root: show gadget icon -->
					<div class="text-orange-500 dark:text-orange-400 [&>svg]:size-5">{@html Gadget}</div>
				{:else}
					<!-- Not at root: show back button -->
					<button
						onclick={goBack}
						class="-m-1 cursor-pointer rounded p-1 text-orange-500 dark:text-orange-400 transition-all hover:bg-orange-100 dark:hover:bg-orange-900/30 [&>svg]:size-5"
						title="Go back"
					>
						{@html ChevronLeft}
					</button>
				{/if}
			</div>
			<h2 class="text-lg font-semibold">{panelTitle}</h2>
		</div>
		<div class="flex items-center gap-2">
			<button
				onclick={onHide}
				class="cursor-pointer text-gray-600 dark:text-gray-400 transition-all hover:text-orange-400"
				title="Hide Wizard"
			>
				{@html Close}
			</button>
		</div>
	</div>

	<!-- Body -->
	<div class="flex flex-1 flex-col gap-2 p-6">
		<!-- Question header (only shown at root) -->
		{#if isAtRoot}
			<p class="mb-4 text-gray-600 dark:text-gray-400">{treeConfig.question}</p>
		{/if}

		<!-- Branch view -->
		{#if isCurrentBranch}
			<WizardBranch
				node={currentNode as WizardBranchNode}
				{treeConfig}
				onNavigate={navigateTo}
				{showTelemetryNote}
			/>
		{/if}

		<!-- Endpoint view -->
		{#if isCurrentEndpoint}
			<WizardEndpoint
				node={currentNode as WizardEndpointNode}
				nodeId={currentNodeId}
				{env}
				{treeConfig}
				detached={inheritedDetached}
				onRun={handleRun}
			/>
		{/if}
	</div>
</div>
