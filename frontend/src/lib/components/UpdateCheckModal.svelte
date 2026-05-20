<script lang="ts">
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';
	import { configuration } from '$lib/stores/configuration.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import updateIcon from '$lib/icons/arrow-path.svelte';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	function handleEnable() {
		configuration.set('checkForUpdates', true);
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
	title={t('Check for Updates')}
	icon={updateIcon}
	size="sm"
	onClose={handleDecline}
>
	<div class="space-y-4">
		<p class="text-gray-700 dark:text-gray-300">
			{t(
				'Would you like Inspektor Gadget Desktop to automatically check for updates when it starts?'
			)}
		</p>
		<p class="text-sm text-gray-500 dark:text-gray-500">
			{t(
				'This will connect to GitHub to fetch the latest release information. You can change this setting anytime in Settings.'
			)}
		</p>
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={handleDecline}>{t('No, thanks')}</Button>
		<Button variant="primary" onclick={handleEnable}>{t('Enable update checks')}</Button>
	{/snippet}
</BaseModal>
