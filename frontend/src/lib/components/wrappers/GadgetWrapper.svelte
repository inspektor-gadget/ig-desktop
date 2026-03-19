<script lang="ts">
	import { setContext } from 'svelte';
	import { apiService, type RequestCommand } from '$lib/services/api.service.svelte';
	import Gadget from '../Gadget.svelte';
	import type { ViewConfig } from '$lib/types/view-config';
	import type { CellClickHandler, CellContextMenuHandler } from '$lib/types/cell-interaction';

	interface Props {
		instanceID: string;
		viewConfig?: ViewConfig;
		onCellClick?: CellClickHandler;
		onCellContextMenu?: CellContextMenuHandler;
	}

	let { instanceID, viewConfig, onCellClick, onCellContextMenu }: Props = $props();

	setContext('api', {
		request: (cmd: RequestCommand) => apiService.request(cmd)
	});
</script>

<Gadget {instanceID} {viewConfig} {onCellClick} {onCellContextMenu} />
