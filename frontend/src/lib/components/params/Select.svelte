<script lang="ts">
	import Title from './Title.svelte';
	import Select from '$lib/components/forms/Select.svelte';

	interface Param {
		key: string;
		title?: string;
		description?: string;
		possibleValues: string[];
	}

	interface Config {
		values: Record<string, string>;
	}

	interface Props {
		param: Param;
		config: Config;
	}

	let { param, config }: Props = $props();

	// Convert possibleValues array to options format
	const options = $derived(
		param.possibleValues.map((value) => ({
			value,
			label: value
		}))
	);

	// Ensure value is never undefined
	let value = $state(config.values[param.key] || '');

	$effect(() => {
		config.values[param.key] = value;
	});
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div>
	<Select bind:value {options} class="text-sm" />
</div>
