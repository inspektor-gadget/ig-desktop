<script lang="ts">
	import Title from './Title.svelte';
	import Checkbox from '$lib/components/forms/Checkbox.svelte';

	interface Param {
		key: string;
		title?: string;
		description?: string;
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

	// Parse default value - treat 'true' as true, everything else as false
	const defaultChecked = param.defaultValue === 'true';

	// Initialize from existing config value, or use default
	const existingValue = config.get(param);
	let checked = $state(existingValue !== undefined ? existingValue === 'true' : defaultChecked);

	$effect(() => {
		// Only set value if it differs from the default
		if (checked !== defaultChecked) {
			config.set(param, '' + checked);
		} else {
			// Remove from values if it matches the default
			config.set(param, '');
		}
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
