<script lang="ts">
	import Title from './Title.svelte';
	import Input from '$lib/components/forms/Input.svelte';

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

	// Initialize from existing config value, or leave empty (placeholder shows default)
	let value = $state(config.get(param) || '');

	$effect(() => {
		// Only set value if it differs from the default
		if (value !== '' && value !== param.defaultValue) {
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
<div class="grow">
	<Input type="number" bind:value placeholder={param.defaultValue} />
</div>
