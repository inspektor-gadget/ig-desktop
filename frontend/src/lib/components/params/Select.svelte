<script lang="ts">
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
	const existingValue = config.get(param);
	let value = $state(existingValue !== undefined ? existingValue : param.defaultValue || '');

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
