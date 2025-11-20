<script lang="ts">
	import type { RangeSetting } from '$lib/config.types';

	interface Props {
		setting: RangeSetting;
		value: number;
		onChange: (value: number) => void;
	}

	let { setting, value, onChange }: Props = $props();
</script>

<div class="mb-4">
	<label for={setting.key} class="mb-2 block text-sm text-gray-300">{setting.title}</label>
	{#if setting.description}
		<p class="mb-2 text-xs text-gray-500">{setting.description}</p>
	{/if}
	<div class="flex items-center gap-4">
		<input
			id={setting.key}
			type="range"
			{value}
			oninput={(e) => onChange(Number(e.currentTarget.value))}
			min={setting.min}
			max={setting.max}
			step={setting.step}
			class="flex-1"
		/>
		<span class="w-12 text-sm text-gray-400">{value}{setting.unit || ''}</span>
	</div>
</div>
