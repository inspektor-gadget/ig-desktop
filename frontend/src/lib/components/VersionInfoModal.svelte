<script lang="ts">
	import { openExternalURL } from '$lib/utils/external-links';
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';
	import { apiService, type CheckForUpdatesResponse } from '$lib/services/api.service.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import infoIcon from '$lib/icons/info-circle.svelte';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	let loading = $state(false);
	let error = $state('');
	let versionData = $state({
		currentVersion: '',
		latestVersion: '',
		igLibraryVersion: '',
		updateAvailable: false,
		releasesUrl: 'https://github.com/inspektor-gadget/ig-desktop/releases'
	});

	// Fetch version info when modal opens
	$effect(() => {
		if (open) {
			checkForUpdates();
		}
	});

	function checkForUpdates() {
		loading = true;
		error = '';

		apiService
			.request<CheckForUpdatesResponse>({ cmd: 'checkForUpdates' })
			.then((data) => {
				if (data) {
					versionData = {
						currentVersion: data.currentVersion || 'unknown',
						latestVersion: data.latestVersion || '',
						igLibraryVersion: data.igLibraryVersion || 'unknown',
						updateAvailable: data.updateAvailable || false,
						releasesUrl: data.releasesUrl || versionData.releasesUrl
					};
					if (data.error) {
						error = data.error;
					}
				}
			})
			.catch((err) => {
				console.error('Failed to check for updates:', err);
				error = t('Failed to check for updates');
			})
			.finally(() => {
				loading = false;
			});
	}

	function handleClose() {
		open = false;
		onClose?.();
	}

	function openReleasesPage() {
		openExternalURL(versionData.releasesUrl);
	}
</script>

<BaseModal
	bind:open
	title={t('Version Information')}
	icon={infoIcon}
	size="sm"
	onClose={handleClose}
>
	<div class="space-y-4">
		{#if loading}
			<div class="flex items-center justify-center py-8">
				<svg
					class="h-8 w-8 animate-spin text-blue-500"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
			</div>
		{:else}
			<div class="space-y-3">
				<div class="flex justify-between rounded-ig-md bg-gray-100 dark:bg-gray-900/50 px-4 py-3">
					<span class="text-gray-600 dark:text-gray-400">{t('Current Version')}</span>
					<span class="font-mono text-gray-800 dark:text-gray-200"
						>{versionData.currentVersion}</span
					>
				</div>

				<div class="flex justify-between rounded-ig-md bg-gray-100 dark:bg-gray-900/50 px-4 py-3">
					<span class="text-gray-600 dark:text-gray-400">{t('Latest Version')}</span>
					<span class="font-mono text-gray-800 dark:text-gray-200">
						{#if versionData.latestVersion}
							<button
								onclick={openReleasesPage}
								class="text-blue-400 hover:text-blue-300 hover:underline"
								title={t('Open releases page')}
							>
								{versionData.latestVersion}
							</button>
							{#if versionData.updateAvailable}
								<span
									class="ml-2 rounded-ig-sm bg-blue-500/20 px-2 py-0.5 text-xs text-blue-600 dark:text-blue-400"
								>
									{t('Update available')}
								</span>
							{/if}
						{:else if error}
							<span class="text-gray-500 dark:text-gray-500">{t('Unable to fetch')}</span>
						{:else}
							<span class="text-gray-500 dark:text-gray-500">{t('Checking...')}</span>
						{/if}
					</span>
				</div>

				<div class="flex justify-between rounded-ig-md bg-gray-100 dark:bg-gray-900/50 px-4 py-3">
					<span class="text-gray-600 dark:text-gray-400">{t('Inspektor Gadget Library')}</span>
					<span class="font-mono text-gray-800 dark:text-gray-200"
						>{versionData.igLibraryVersion}</span
					>
				</div>
			</div>

			{#if error}
				<div
					class="rounded-ig-md bg-red-100 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400"
				>
					{error}
				</div>
			{/if}

			{#if versionData.updateAvailable}
				<div class="rounded-ig-md bg-blue-100 dark:bg-blue-900/20 px-4 py-3">
					<p class="text-sm text-blue-700 dark:text-blue-300">
						{t('A new version is available! Click the button below to visit the releases page.')}
					</p>
				</div>
			{/if}
		{/if}
	</div>

	{#snippet footer()}
		{#if versionData.updateAvailable}
			<Button variant="primary" onclick={openReleasesPage}>{t('View Releases')}</Button>
		{/if}
		<Button variant="secondary" onclick={checkForUpdates} disabled={loading}>
			{loading ? t('Checking...') : t('Check Again')}
		</Button>
		<Button variant="secondary" onclick={handleClose}>{t('Close')}</Button>
	{/snippet}
</BaseModal>
