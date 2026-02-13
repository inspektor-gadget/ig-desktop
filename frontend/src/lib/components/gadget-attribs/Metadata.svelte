<script lang="ts">
	import Monaco from '../Monaco.svelte';

	let { gadgetInfo } = $props();

	let metadata = $state('');
	$effect(() => {
		metadata = atob(gadgetInfo.metadata);
	});
</script>

<!-- Fixed Header -->
<div class="shrink-0 border-b border-ig-border bg-ig-surface">
	<div class="flex items-center justify-between px-2 py-1.5">
		<span class="font-medium">Gadget Metadata</span>
	</div>
</div>

<Monaco content={metadata} readOnly={true} />
