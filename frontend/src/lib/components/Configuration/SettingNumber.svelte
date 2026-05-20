<script lang="ts">
	import type { NumberSetting } from '$lib/config.types';
	import Input from '$lib/components/forms/Input.svelte';
	import { t } from '$lib/i18n/index.svelte';

	interface Props {
		setting: NumberSetting;
		value: number;
		onChange: (value: number) => void;
	}

	let { setting, value, onChange }: Props = $props();
</script>

<Input
	type="number"
	{value}
	oninput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
	label={t(setting.title)}
	description={setting.description ? t(setting.description) : undefined}
/>
