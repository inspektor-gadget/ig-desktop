<script>
	import Gadget from '$lib/components/Gadget.svelte';
	import { page } from '$app/state';
</script>

<Gadget instanceID={page.params.instanceID} />
