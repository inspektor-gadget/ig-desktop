<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NetworkNodeData } from '$lib/types/networkmap';

	interface Props {
		data: NetworkNodeData;
		selected?: boolean;
	}
	let { data, selected = false }: Props = $props();

	// Derive handles and labels reactively
	const handles = $derived(data.handles ?? []);
	const labels = $derived(data.labels ?? [{ field: 'addr', value: data.addr }]);

	// Build full title from all labels
	const fullTitle = $derived(labels.map((l) => `${l.field}: ${l.value}`).join('\n'));

	// Compute border class based on state
	const borderClass = $derived.by(() => {
		if (selected) return 'border-blue-500 shadow-md shadow-blue-500/30';
		if (data.isActive) return 'border-green-500';
		return 'border-gray-300 dark:border-gray-600';
	});
</script>

<div
	class="address-node rounded-lg border-2 bg-white dark:bg-gray-800 shadow-sm transition-all duration-200 {borderClass}"
>
	<!-- Header with labels from keying fields -->
	<div
		class="flex flex-col gap-0.5 rounded-t-md border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2"
		title={fullTitle}
	>
		<div class="flex items-center justify-between gap-2">
			<span
				class="font-mono text-xs font-semibold text-gray-900 dark:text-gray-100 truncate max-w-[140px]"
			>
				{data.label}
			</span>
			<span
				class="rounded-full bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300 shrink-0"
			>
				{data.connectionCount}
			</span>
		</div>
		<!-- Show additional labels if present -->
		{#if labels.length > 1}
			<div class="flex flex-col gap-0.5 mt-0.5">
				{#each labels.slice(1) as label (label.field)}
					<div class="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
						<span class="text-gray-400 dark:text-gray-500">{label.field}:</span>
						<span class="font-mono truncate max-w-[120px]">{label.value}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Handles / connection points -->
	{#if handles.length > 0}
		<div class="px-1 py-1">
			{#each handles as handle (handle.id)}
				{@const isEphemeral = handle.id.endsWith(':high')}
				<div
					class="handle-row relative flex items-center justify-between px-2 py-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded"
				>
					<span class="font-mono text-[11px]"
						>{handle.proto}:{handle.port}{isEphemeral ? '+' : ''}</span
					>
					<span class="text-[10px] text-gray-400 dark:text-gray-500"
						>({handle.connectionCount})</span
					>

					<!-- Handles on both sides - XYFlow uses whichever matches the edge -->
					<div class="handle-wrapper handle-left" class:active={handle.isActive}>
						<Handle
							type="target"
							position={Position.Left}
							id={handle.id}
							style="position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"
							class="!bg-gray-400 dark:!bg-gray-500 dark:!border-gray-800"
						/>
					</div>
					<div class="handle-wrapper handle-right" class:active={handle.isActive}>
						<Handle
							type="source"
							position={Position.Right}
							id={handle.id}
							style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"
							class="!bg-gray-400 dark:!bg-gray-500 dark:!border-gray-800"
						/>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- Default handles when no specific proto:port -->
		<div
			class="handle-row relative flex items-center justify-center px-2 py-2 text-gray-400 dark:text-gray-500 text-xs"
		>
			<span>No ports</span>
			<div class="handle-wrapper handle-right">
				<Handle
					type="source"
					position={Position.Right}
					id="default-source"
					style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"
					class="!bg-gray-400 dark:!bg-gray-500 dark:!border-gray-800"
				/>
			</div>
			<div class="handle-wrapper handle-left">
				<Handle
					type="target"
					position={Position.Left}
					id="default-target"
					style="position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"
					class="!bg-gray-400 dark:!bg-gray-500 dark:!border-gray-800"
				/>
			</div>
		</div>
	{/if}
</div>

<style>
	.address-node {
		min-width: 140px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	/* Handle wrapper for positioning and pulse animation */
	.handle-wrapper {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		width: 12px;
		height: 12px;
	}

	.handle-wrapper.handle-right {
		right: -11px;
	}

	.handle-wrapper.handle-left {
		left: -11px;
	}

	/* Pulse animation for active handles */
	.handle-wrapper.active::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #22c55e;
		animation: pulse 1s ease-in-out infinite;
		pointer-events: none;
	}

	@keyframes pulse {
		0%,
		100% {
			transform: translate(-50%, -50%) scale(1);
			opacity: 0.8;
		}
		50% {
			transform: translate(-50%, -50%) scale(1.8);
			opacity: 0;
		}
	}

	/* Active handle dot color */
	.handle-wrapper.active :global(.svelte-flow__handle) {
		background: #22c55e !important;
	}

	/* Override XYFlow's default handle positioning */
	.handle-wrapper :global(.svelte-flow__handle) {
		position: absolute !important;
		top: 50% !important;
		left: 50% !important;
		transform: translate(-50%, -50%) !important;
		bottom: auto !important;
		right: auto !important;
		margin: 0 !important;
	}
</style>
