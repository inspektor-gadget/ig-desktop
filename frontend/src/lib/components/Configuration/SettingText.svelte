<script lang="ts">
	import type { TextSetting } from '$lib/config.types';
	import Input from '$lib/components/forms/Input.svelte';

	interface Props {
		setting: TextSetting;
		value: string;
		onChange: (value: string) => void;
	}

	let { setting, value, onChange }: Props = $props();
</script>

<Input
	{value}
	oninput={(e) => onChange((e.target as HTMLInputElement).value)}
	label={setting.title}
	description={setting.description}
	placeholder={setting.placeholder || ''}
/>
