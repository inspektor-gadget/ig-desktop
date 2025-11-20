<script lang="ts">
	import Cog from '$lib/icons/cog.svg?raw';
	import { configuration } from '$lib/stores/configuration.svelte';
	import type { SettingType } from '$lib/config.types';
	import { configurationSchema } from '$lib/config';
	import SettingToggle from './Configuration/SettingToggle.svelte';
	import SettingSelect from './Configuration/SettingSelect.svelte';
	import SettingText from './Configuration/SettingText.svelte';
	import SettingNumber from './Configuration/SettingNumber.svelte';
	import SettingRange from './Configuration/SettingRange.svelte';
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';
	import type { Component } from 'svelte';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	let activeCategory = $state('general');

	// Map setting types to their components
	const settingComponents: Record<SettingType, Component<any>> = {
		toggle: SettingToggle,
		select: SettingSelect,
		text: SettingText,
		number: SettingNumber,
		range: SettingRange
	};

	function handleClose() {
		open = false;
		onClose?.();
	}

	function handleSettingChange(key: string, value: boolean | string | number) {
		configuration.set(key, value);
	}
</script>

<BaseModal bind:open title="Settings" icon={Cog} size="lg" onClose={handleClose}>
	<!-- Content area with sidebar and panel -->
	<div class="-mx-6 -my-6 flex h-[500px] gap-0">
		<!-- Left Sidebar - Categories -->
		<div class="w-48 border-r border-gray-800 bg-gray-900/50">
			<nav class="p-2">
				{#each configurationSchema.categories as category}
					<button
						onclick={() => (activeCategory = category.id)}
						class="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all {activeCategory ===
						category.id
							? 'bg-blue-500/10 text-blue-400'
							: 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-300'}"
					>
						<span class="text-base">{category.name}</span>
					</button>
				{/each}
			</nav>
		</div>

		<!-- Right Panel - Settings Content -->
		<div class="flex flex-1 flex-col">
			<!-- Settings Body -->
			<div class="flex-1 overflow-y-auto p-6">
				{#each configurationSchema.categories as category}
					{#if activeCategory === category.id}
						<div class="space-y-6">
							<div>
								<h3 class="mb-4 text-base font-semibold text-gray-200">
									{category.name} Settings
								</h3>

								<div class="space-y-4">
									{#each category.settings as setting}
										{@const value = configuration.get(setting.key)}
										{@const SettingComponent = settingComponents[setting.type]}
										<SettingComponent
											{setting}
											{value}
											onChange={(newValue) => handleSettingChange(setting.key, newValue)}
										/>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={handleClose}>Close</Button>
	{/snippet}
</BaseModal>
