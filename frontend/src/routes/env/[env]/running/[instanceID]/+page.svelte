<script>
	import DataSource from '$lib/components/datasource.svelte';
	import { page } from '$app/state';

	import { instances } from '$lib/shared/instances.svelte.js';

	let instanceID = $derived(page.params.instanceID);

	let gadgetError = $derived(instances[instanceID]?.error);
	console.log(instances[instanceID]);
</script>

{#if gadgetError}
	<div class="p-2 bg-red-900 text-white text-sm border-y border-red-400 text-center">
		Error: {gadgetError}
	</div>
{/if}

<DataSource instanceID={instanceID} />

