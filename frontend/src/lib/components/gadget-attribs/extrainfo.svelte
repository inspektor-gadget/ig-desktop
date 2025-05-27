<script>
	import Monaco from '../monaco.svelte';
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import { environments } from '$lib/shared/environments.svelte.js';
	import mermaid from 'mermaid';

	let { data, gadgetInfo } = $props();
	const api = getContext('api');

	let env = $derived(environments[page.params.env]);

	let graphs = $state({});
	let info = $state({});

	$effect(() => {
		if (!env.id || !gadgetInfo?.imageName) {
			return;
		}

		mermaid.initialize({ startOnLoad: true, theme: 'dark' });

		api
			.request({ cmd: 'getGadgetInfo', data: { url: gadgetInfo.imageName, environmentID: env.id } })
			.then((res) => {
				let extraInfo = res.extraInfo.data;
				if (!extraInfo) {
					return;
				}
				for (const key in extraInfo) {
					if (extraInfo[key].contentType == 'text/mermaid') {
						let graph = atob(extraInfo[key].content);
						let id = `mermaid-${Math.random().toString(2).substring(2, 15)}`;
						mermaid
							.render(id, graph)
							.then(({ svg }) => {
								console.log(svg);
								graphs[key] = svg;
							})
							.catch((err) => {
								console.error(`Error rendering mermaid graph for key ${key}:`, err);
								graphs[key] = `<div>Error rendering graph: ${err.message}</div>`;
							});
					}

					if (
						extraInfo[key].contentType == 'text/plain' ||
						extraInfo[key].contentType == 'application/json'
					) {
						try {
							info[key] = atob(extraInfo[key].content);
						} catch (e) {
							console.error(`Error decoding content for key ${key}:`, e);
							info[key] = 'Error decoding content.';
						}
					}
				}
			})
			.catch((err) => {
				console.error('Error fetching gadget info:', err);
			});
	});
</script>

<div class="flex flex-1 flex-col space-y-4 overflow-scroll">
	<!-- Mermaid graphs -->
	{#if graphs && Object.keys(graphs).length > 0}
		{#each Object.entries(graphs) as [key, svg]}
			<div class="mb-4">
				<h3 class="text-md mb-2 font-semibold">{key}</h3>
				<button
					class="text-sm text-blue-500 hover:underline"
					onclick={() => {
						const pre = document.getElementById(`extra-info-${key}`);
						if (pre) {
							pre.classList.toggle('hidden');
						}
					}}>Toggle Content</button
				>
				<div id={`extra-info-${key}`} class="hidden overflow-x-auto rounded border p-2">
					{@html svg}
				</div>
			</div>
		{/each}
	{/if}

	<!-- JSON extra info -->
	{#if info && Object.keys(info).length > 0}
		{#each Object.entries(info) as [key, content]}
			<div class="mb-4">
				<h3 class="text-md mb-2 font-semibold">{key}</h3>
				<button
					class="cursor-pointer text-sm text-blue-500"
					onclick={() => {
						const pre = document.getElementById(`extra-info-${key}`);
						if (pre) {
							pre.classList.toggle('hidden');
						}
					}}>Toggle Content</button
				>
			</div>
			<div id={`extra-info-${key}`} class="hidden">{content}</div>
		{/each}
	{/if}
</div>
