<script lang="ts">
	import type { TextSetting } from '#lib/config.types.ts';
	import Input from '#lib/components/forms/Input.svelte';
	import { t } from '#lib/i18n/index.svelte.ts';

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
	label={t(setting.title)}
	description={setting.description ? t(setting.description) : undefined}
	placeholder={setting.placeholder || ''}
/>
