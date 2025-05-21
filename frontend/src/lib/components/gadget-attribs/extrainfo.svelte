<script>
	import Monaco from '../monaco.svelte';
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import { environments } from '$lib/shared/environments.svelte.js';

	let { data } = $props();

	const api = getContext('api');
	let env = $derived(environments[page.params.env]);
	let gadgetInfoSource = $state('');

	$effect(() => {
		if (!env.id || !data?.url) {
			gadgetInfoSource = "";
			return;
		}
		api.request({ cmd: 'getGadgetInfo', data: { url: data.url, environmentID: env.id } }).then((res) => {
			gadgetInfoSource = JSON.stringify(res, null, '  ');
		}).catch((err) => {
            console.error('Error fetching gadget info:', err);
            gadgetInfoSource = "";
        });
	});
</script>

<Monaco content={gadgetInfoSource} readOnly={true} />
