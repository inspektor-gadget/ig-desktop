<script lang="ts">
	import Cog from '$lib/icons/cog.svelte';
	import { configuration } from '$lib/stores/configuration.svelte';
	import type { SettingType } from '$lib/config.types';
	import { getFullConfigurationSchema } from '$lib/config';
	import SettingToggle from './Configuration/SettingToggle.svelte';
	import SettingSelect from './Configuration/SettingSelect.svelte';
	import SettingText from './Configuration/SettingText.svelte';
	import SettingNumber from './Configuration/SettingNumber.svelte';
	import SettingRange from './Configuration/SettingRange.svelte';
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';
	import type { Component } from 'svelte';
	import { settingsDialog } from '$lib/stores/settings-dialog.svelte';
	import { t, getLanguage, setLanguage } from '$lib/i18n/index.svelte';
	import { supportedLanguages } from '$lib/i18n/supported-languages';
	// Import to ensure plugin config service is initialized
	import '$lib/services/plugin-config.service';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	// Track which setting is highlighted for deep-linking
	let highlightedSetting = $state<string | null>(null);

	// Get the full schema including plugin categories (reactive)
	const fullSchema = $derived(getFullConfigurationSchema());

	// Filter categories based on requiredSetting
	const visibleCategories = $derived(
		fullSchema.categories.filter((category) => {
			if (!category.requiredSetting) return true;
			return configuration.get(category.requiredSetting) === true;
		})
	);

	let activeCategory = $state(fullSchema.categories[0]?.id ?? '');

	// Reset to first visible category if current becomes hidden
	$effect(() => {
		const isVisible = visibleCategories.some((c) => c.id === activeCategory);
		if (!isVisible && visibleCategories.length > 0) {
			activeCategory = visibleCategories[0].id;
		}
	});

	// Handle deep-linking when modal opens with target category/setting
	$effect(() => {
		if (open && settingsDialog.targetCategory) {
			activeCategory = settingsDialog.targetCategory;
		}
		if (open && settingsDialog.targetSetting) {
			highlightedSetting = settingsDialog.targetSetting;
			// Clear highlight after a delay
			setTimeout(() => {
				highlightedSetting = null;
				settingsDialog.clearTarget();
			}, 2000);
		}
	});

	// Map setting types to their components.
	// The five setting components accept differently-typed `value`/`setting` props
	// (boolean/string/number), so this registry is intentionally type-erased.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

<BaseModal bind:open title={t('Settings')} icon={Cog} size="lg" onClose={handleClose}>
	<!-- Content area with sidebar and panel -->
	<div class="-mx-6 -my-6 flex h-[500px] gap-0">
		<!-- Left Sidebar - Categories -->
		<div
			class="w-48 border-r border-gray-200 bg-gray-100/50 dark:border-gray-800 dark:bg-gray-900/50"
		>
			<nav class="p-2">
				{#each visibleCategories as category (category.id)}
					<button
						onclick={() => (activeCategory = category.id)}
						class="mb-1 flex w-full items-center gap-3 rounded-ig-md px-3 py-2 text-sm transition-all {activeCategory ===
						category.id
							? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
							: 'text-gray-600 dark:text-gray-400 hover:bg-gray-200/50 dark:hover:bg-gray-800/50 hover:text-gray-800 dark:hover:text-gray-300'}"
					>
						<span class="text-base">{t(category.name)}</span>
					</button>
				{/each}
			</nav>
		</div>

		<!-- Right Panel - Settings Content -->
		<div class="flex flex-1 flex-col">
			<!-- Settings Body -->
			<div class="flex-1 overflow-y-auto p-6">
				{#each visibleCategories as category (category.id)}
					{#if activeCategory === category.id}
						<div class="space-y-6">
							<div>
								<h3 class="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200">
									{t(`${category.name} Settings`)}
								</h3>

								<div class="space-y-4">
									{#each category.settings as setting (setting.key)}
										{@const value = configuration.get(setting.key)}
										{@const SettingComponent = settingComponents[setting.type]}
										<div
											class="rounded-ig-md transition-all duration-300 {highlightedSetting ===
											setting.key
												? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900'
												: ''}"
										>
											<SettingComponent
												{setting}
												{value}
												onChange={(newValue: string | number | boolean) =>
													handleSettingChange(setting.key, newValue)}
											/>
										</div>
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
		<div class="mr-auto flex items-center gap-2">
			<label for="ig-language-select" class="text-sm text-ig-text-secondary">{t('Language')}</label>
			<select
				id="ig-language-select"
				value={getLanguage()}
				onchange={(e) => setLanguage(e.currentTarget.value)}
				class="rounded-ig-sm border border-ig-border-strong bg-ig-surface-raised px-2 py-1 text-sm text-ig-text focus:border-ig-primary focus:ring-ig-primary-muted focus:outline-none"
			>
				{#each Object.entries(supportedLanguages) as [code, name] (code)}
					<option value={code}>{name}</option>
				{/each}
			</select>
		</div>
		<Button variant="secondary" onclick={handleClose}>{t('Close')}</Button>
	{/snippet}
</BaseModal>
