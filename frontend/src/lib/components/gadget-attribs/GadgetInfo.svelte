<script lang="ts">
	import Monaco from '../Monaco.svelte';

	let { gadgetInfo } = $props();

	let gadgetInfoSource = $state('');
	$effect(() => {
		gadgetInfoSource = JSON.stringify(gadgetInfo, null, '  ');
	});
</script>

<!-- Fixed Header -->
<div class="shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950">
	<div class="flex items-center justify-between px-2 py-1.5">
		<span class="font-medium">GadgetInfo</span>
	</div>
</div>

<Monaco content={gadgetInfoSource} readOnly={true} />
