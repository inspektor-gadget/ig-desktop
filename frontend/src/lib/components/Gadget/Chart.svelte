<script lang="ts">
	import Chart from '$lib/icons/chart.svg?raw';
	import Timeline from '../charts/Timeline2.svelte';
	import { getContext } from 'svelte';

	const gadget = getContext('gadget');

	let { ds, dsID } = $props();

	let data = $state<never[]>([]);

	function updateMetrics(d: never) {
		data = d;
	}

	gadget.subscribeMetrics(dsID, updateMetrics);
</script>

<div class="sticky left-0 flex flex-1 flex-row bg-gray-950 p-2">
	<div class="pr-2">{@html Chart}</div>
	<h2 class="flex-122">{ds.name}</h2>
</div>

{#if data}
	<Timeline {data} />
{/if}
