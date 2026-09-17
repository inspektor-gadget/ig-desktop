<script lang="ts">
	import { setContext } from 'svelte';
	import { apiService } from '$lib/services/api.service.svelte';
	import type { ResultViewChange, ResultViewState } from '$lib/types/embedding';
	import GadgetWrapper from './wrappers/GadgetWrapper.svelte';
	import ConfigurationModal from './ConfigurationModal.svelte';
	import ConfirmationModal from './ConfirmationModal.svelte';
	import ToastContainer from './ToastContainer.svelte';
	import { settingsDialog } from '$lib/stores/settings-dialog.svelte';

	interface Props {
		instanceID: string;
		viewState?: ResultViewState;
		onViewStateChange?: (state: ResultViewChange) => void;
		showToasts?: boolean;
	}

	let { instanceID, viewState, onViewStateChange, showToasts = true }: Props = $props();
	setContext('api', apiService);
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-ig-surface text-ig-text">
	<GadgetWrapper {instanceID} {viewState} {onViewStateChange} />
	<ConfirmationModal />
	<ConfigurationModal bind:open={settingsDialog.open} />
	{#if showToasts}
		<ToastContainer />
	{/if}
</div>
