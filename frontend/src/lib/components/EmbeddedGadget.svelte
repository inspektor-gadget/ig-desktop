<script lang="ts">
	import { setContext } from 'svelte';
	import { apiService } from '$lib/services/api.service.svelte';
	import type { ResultViewChange, ResultViewState } from '$lib/types/embedding';
	import type { FileOutputCapability } from '$lib/types';
	import type { CellContextMenuHandler } from '$lib/types/cell-interaction';
	import { instances } from '$lib/shared/instances.svelte';
	import { setFileOutputCapability } from '$lib/shared/file-output.svelte';
	import GadgetWrapper from './wrappers/GadgetWrapper.svelte';
	import ConfigurationModal from './ConfigurationModal.svelte';
	import ConfirmationModal from './ConfirmationModal.svelte';
	import ToastContainer from './ToastContainer.svelte';
	import { settingsDialog } from '$lib/stores/settings-dialog.svelte';

	interface Props {
		instanceID: string;
		viewState?: ResultViewState;
		onViewStateChange?: (state: ResultViewChange) => void;
		onCellContextMenu?: CellContextMenuHandler;
		showToasts?: boolean;
		fileOutput?: FileOutputCapability;
	}

	let {
		instanceID,
		viewState,
		onViewStateChange,
		onCellContextMenu,
		showToasts = true,
		fileOutput
	}: Props = $props();
	let acknowledgedFileStatus = $state<string | undefined>();
	setContext('api', apiService);
	setContext('fileOutput', () => fileOutput);
	// Token-checked: unmounting one embedding never clears another's capability.
	$effect(() => setFileOutputCapability(fileOutput));
	$effect(() => {
		if (instances[instanceID]?.output && acknowledgedFileStatus !== instanceID) {
			acknowledgedFileStatus = instanceID;
			onViewStateChange?.({ instanceID, search: '', visualizers: {}, availableVisualizers: {} });
		}
	});
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-ig-surface text-ig-text">
	<GadgetWrapper {instanceID} {viewState} {onViewStateChange} {onCellContextMenu} />
	<ConfirmationModal />
	<ConfigurationModal bind:open={settingsDialog.open} />
	{#if showToasts}
		<ToastContainer />
	{/if}
</div>
