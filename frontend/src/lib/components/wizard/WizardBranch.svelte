<script lang="ts">
	import type { WizardBranchNode, WizardNode, WizardTreeConfig } from './wizard-types';
	import { isBranchNode, getNodeLabel } from './wizard-types';

	import Bug from '$lib/icons/bug.svg?raw';
	import Chart from '$lib/icons/chart.svg?raw';
	import Server from '$lib/icons/server.svg?raw';
	import Layers from '$lib/icons/layers.svg?raw';
	import File from '$lib/icons/file.svg?raw';
	import ChevronRight from '$lib/icons/chevron-right.svg?raw';
	import Info from '$lib/icons/info.svg?raw';
	// Note: Breadcrumbs and back navigation are handled by parent GadgetWizard

	interface Props {
		node: WizardBranchNode;
		treeConfig: WizardTreeConfig;
		onNavigate: (nodeId: string) => void;
		showTelemetryNote: boolean;
	}

	let { node, treeConfig, onNavigate, showTelemetryNote }: Props = $props();

	// Map icon names to SVG components
	const iconMap: Record<string, string> = {
		bug: Bug,
		chart: Chart,
		network: Server,
		process: Layers,
		disk: File
	};

	// Get child nodes
	const childNodes = $derived(
		node.children.map((childId) => ({
			id: childId,
			node: treeConfig.nodes[childId]
		}))
	);

	// Get icon for a node
	function getIcon(childNode: WizardNode): string | undefined {
		if (isBranchNode(childNode) && childNode.icon) {
			return iconMap[childNode.icon];
		}
		return undefined;
	}

	// Get description for a node
	function getDescription(childNode: WizardNode): string | undefined {
		return childNode.description;
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Telemetry note banner -->
	{#if showTelemetryNote}
		<div
			class="flex flex-row items-start gap-3 rounded-lg border border-blue-300/50 dark:border-blue-800/50 bg-blue-100/20 dark:bg-blue-900/20 p-3 text-sm"
		>
			<span class="mt-0.5 text-blue-500">{@html Info}</span>
			<div class="flex flex-col gap-1">
				<span class="font-medium text-blue-700 dark:text-blue-300">Telemetry Setup</span>
				<span class="text-blue-600 dark:text-blue-400">
					Telemetry gadgets export metrics to configured backends. Ensure Inspektor Gadget is
					deployed with telemetry exporters enabled.
				</span>
			</div>
		</div>
	{/if}

	<!-- Child options grid -->
	<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
		{#each childNodes as { id, node: childNode } (id)}
			{@const icon = getIcon(childNode)}
			<button
				onclick={() => onNavigate(id)}
				class="group flex cursor-pointer flex-col gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/50 dark:bg-gray-900/50 p-4 text-left transition-all hover:border-orange-500/50 hover:bg-gray-100 dark:hover:bg-gray-900"
			>
				<div class="flex flex-row items-center justify-between gap-3">
					<div class="flex flex-row items-center gap-3">
						{#if icon}
							<span class="text-gray-500 transition-colors group-hover:text-orange-500">
								{@html icon}
							</span>
						{/if}
						<span class="font-medium text-gray-800 dark:text-gray-200">
							{getNodeLabel(childNode)}
						</span>
					</div>
					<span class="text-gray-400 transition-colors group-hover:text-orange-500">
						{@html ChevronRight}
					</span>
				</div>
				{#if getDescription(childNode)}
					<p class="text-sm text-gray-500">
						{getDescription(childNode)}
					</p>
				{/if}
			</button>
		{/each}
	</div>
</div>
