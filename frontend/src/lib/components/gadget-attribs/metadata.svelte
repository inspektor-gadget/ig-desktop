<script>
	import Monaco from '../monaco.svelte';

	let { gadgetInfo } = $props();

	let metadata = $state('');
	$effect(() => {
		metadata = atob(gadgetInfo.metadata);
	});
</script>

<Monaco content={metadata} readOnly={true} />
