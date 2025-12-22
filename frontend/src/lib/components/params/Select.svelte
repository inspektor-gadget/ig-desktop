<script lang="ts">
	import { untrack } from 'svelte';
	import Title from './Title.svelte';
	import Select from '$lib/components/forms/Select.svelte';

	interface Param {
		key: string;
		title?: string;
		description?: string;
		possibleValues: string[];
		defaultValue?: string;
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

	// Convert possibleValues array to options format
	const options = $derived(
		param.possibleValues.map((value) => ({
			value,
			label: value
		}))
	);

	// Initialize from existing config value, or use default
	// untrack() explicitly indicates this is a one-time read at mount time
	const initialValue = untrack(() => config.get(param));
	const defaultVal = untrack(() => param.defaultValue);
	let value = $state(initialValue !== undefined ? initialValue : defaultVal || '');

	$effect(() => {
		// Only set value if it differs from the default
		if (value !== (param.defaultValue || '') && value !== '') {
			config.set(param, value);
		} else {
			// Remove from values if it matches the default or is empty
			config.set(param, '');
		}
	});
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div>
	<Select bind:value {options} class="text-sm" />
</div>
