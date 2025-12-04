<script lang="ts">
	import Gadget from '$lib/components/Gadget.svelte';
	import { page } from '$app/state';
</script>

{#if page.params.instanceID}
	<Gadget instanceID={page.params.instanceID} />
{/if}
