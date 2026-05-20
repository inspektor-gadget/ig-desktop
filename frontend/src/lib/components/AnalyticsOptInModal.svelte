<script lang="ts">
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';
	import { configuration } from '$lib/stores/configuration.svelte';
	import { analyticsService } from '$lib/services/analytics.service.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import analyticsIcon from '$lib/icons/chart-bars.svelte';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	function handleEnable() {
		configuration.set('sendAnalytics', true);
		analyticsService.initialize();
		open = false;
		onClose?.();
	}

	function handleDecline() {
		// Keep the default (false), just close the modal
		open = false;
		onClose?.();
	}
</script>

<BaseModal
	bind:open
	title={t('Help Improve Inspektor Gadget')}
	icon={analyticsIcon}
	size="sm"
	onClose={handleDecline}
>
	<div class="space-y-4">
		<p class="text-gray-700 dark:text-gray-300">
			{t(
				'Would you like to help improve Inspektor Gadget Desktop by sharing anonymous usage data?'
			)}
		</p>
		<div
			class="rounded-ig-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 p-3 text-sm text-gray-600 dark:text-gray-400"
		>
			<p class="mb-2 font-medium text-gray-700 dark:text-gray-300">{t('What we collect:')}</p>
			<ul class="ml-4 list-disc space-y-1">
				<li>{t('Which official gadgets you run (only from the Inspektor Gadget project)')}</li>
			</ul>
			<p class="mt-3 mb-2 font-medium text-gray-700 dark:text-gray-300">
				{t("What we don't collect:")}
			</p>
			<ul class="ml-4 list-disc space-y-1">
				<li>{t('Any personal information')}</li>
				<li>{t('Third-party gadget URLs')}</li>
				<li>{t('Parameters or data from gadget runs')}</li>
			</ul>
		</div>
		<p class="text-sm text-gray-500 dark:text-gray-500">
			{t('You can change this setting anytime in Settings under General.')}
		</p>
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={handleDecline}>{t('No, thanks')}</Button>
		<Button variant="primary" onclick={handleEnable}>{t('Enable analytics')}</Button>
	{/snippet}
</BaseModal>
