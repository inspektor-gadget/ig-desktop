<script lang="ts">
	import type { SelectSetting } from '$lib/config.types';
	import Select from '$lib/components/forms/Select.svelte';
	import { t } from '$lib/i18n/index.svelte';

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
			label: t(label)
		}))
	);
</script>

<Select
	{value}
	{options}
	onchange={(e) => onChange((e.target as HTMLSelectElement).value)}
	label={t(setting.title)}
	description={setting.description ? t(setting.description) : undefined}
/>
