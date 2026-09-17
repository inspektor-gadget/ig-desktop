<script lang="ts">
	import { setContext } from 'svelte';
	import { apiService, type RequestCommand } from '$lib/services/api.service.svelte';
	import Gadget from '../Gadget.svelte';
	import type { ViewConfig } from '$lib/types/view-config';
	import type { ResultViewState, ResultViewChange } from '$lib/types/embedding';
	import type { CellClickHandler, CellContextMenuHandler } from '$lib/types/cell-interaction';

	interface Props {
		instanceID: string;
		viewConfig?: ViewConfig;
		viewState?: ResultViewState;
		onViewStateChange?: (state: ResultViewChange) => void;
		onCellClick?: CellClickHandler;
		onCellContextMenu?: CellContextMenuHandler;
	}

	let {
		instanceID,
		viewConfig,
		viewState,
		onViewStateChange,
		onCellClick,
		onCellContextMenu
	}: Props = $props();

	setContext('api', {
		request: (cmd: RequestCommand) => apiService.request(cmd)
	});
</script>

<Gadget
	{instanceID}
	{viewConfig}
	{viewState}
	{onViewStateChange}
	{onCellClick}
	{onCellContextMenu}
/>
