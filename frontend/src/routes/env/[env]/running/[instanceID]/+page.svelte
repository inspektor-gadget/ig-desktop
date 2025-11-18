<script>
	import DataSource from '$lib/components/datasource.svelte';
	import { page } from '$app/state';
</script>

<DataSource instanceID={page.params.instanceID} />
