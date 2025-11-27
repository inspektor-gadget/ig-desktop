<script lang="ts">
	import type { ToggleSetting } from '$lib/config.types';

	interface Props {
		setting: ToggleSetting;
		value: boolean;
		onChange: (value: boolean) => void;
	}

	let { setting, value, onChange }: Props = $props();
</script>

<div class="flex items-start justify-between gap-4">
	<div class="min-w-0 flex-1">
		<label class="block text-sm text-gray-300">{setting.title}</label>
		{#if setting.description}
			<p class="text-xs text-gray-500">{setting.description}</p>
		{/if}
	</div>
	<button
		onclick={() => onChange(!value)}
		class="relative h-6 w-11 flex-shrink-0 rounded-full transition-colors {value
			? 'bg-blue-500'
			: 'bg-gray-700'}"
		role="switch"
		aria-checked={value}
		aria-label={setting.title}
	>
		<span
			class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform {value
				? 'translate-x-5'
				: ''}"
		></span>
	</button>
</div>
