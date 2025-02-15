<script>
	import Chart from '$lib/icons/chart.svg?raw';
	import Timeline from './charts/Timeline2.svelte';
	import { getContext } from 'svelte';

	const gadget = getContext('gadget');

	export let ds;
	export let dsID;

	let data = [];

	function updateMetrics(d) {
		data = d;
	}

	gadget.subscribeMetrics(dsID, updateMetrics);
</script>
<div class="sticky left-0 p-2 flex flex-row flex-1 bg-gray-950">
	<div class="pr-2">{@html Chart}</div>
	<h2 class="flex-122">{ds.name}</h2>
</div>

{#if data}
	<Timeline {data} />
{/if}
