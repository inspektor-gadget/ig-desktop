<script lang="ts">
	import type { NumberSetting } from '$lib/config.types';
	import Input from '$lib/components/forms/Input.svelte';

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
	label={setting.title}
	description={setting.description}
/>
