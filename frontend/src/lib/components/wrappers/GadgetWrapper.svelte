<script lang="ts">
	import { setContext } from 'svelte';
	import { apiService, type RequestCommand } from '#lib/services/api.service.svelte.ts';
	import Gadget from '../Gadget.svelte';
	import type { ViewConfig } from '#lib/types/view-config.ts';
	import type { ResultViewState, ResultViewChange } from '#lib/types/embedding.ts';
	import type { CellClickHandler, CellContextMenuHandler } from '#lib/types/cell-interaction.ts';

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
