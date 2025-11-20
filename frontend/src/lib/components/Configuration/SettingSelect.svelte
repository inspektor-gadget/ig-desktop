<script lang="ts">
	import type { SelectSetting } from '$lib/config.types';
	import Select from '$lib/components/forms/Select.svelte';

	interface Props {
		setting: SelectSetting;
		value: string;
		onChange: (value: string) => void;
	}

	let { setting, value, onChange }: Props = $props();

	// Convert options object to array format expected by Select component
	const options = $derived(
		Object.entries(setting.options).map(([value, label]) => ({
			value,
			label
		}))
	);
</script>

<Select
	{value}
	{options}
	onchange={(e) => onChange((e.target as HTMLSelectElement).value)}
	label={setting.title}
	description={setting.description}
/>
