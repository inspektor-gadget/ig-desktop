<script lang="ts">
	import Title from './Title.svelte';
	import Checkbox from '$lib/components/forms/Checkbox.svelte';

	interface Param {
		key: string;
		title?: string;
		description?: string;
	}

	interface Config {
		get: (param: Param) => string;
		set: (param: Param, value: string) => void;
	}

	interface Props {
		param: Param;
		config: Config;
	}

	let { param, config }: Props = $props();

	let checked = $state(config.get(param) === 'true');

	$effect(() => {
		config.set(param, '' + checked);
	});
</script>

<div class="flex flex-row gap-4">
	<Checkbox bind:checked />
	<Title
		{param}
		onclick={() => {
			checked = !checked;
		}}
	/>
</div>
