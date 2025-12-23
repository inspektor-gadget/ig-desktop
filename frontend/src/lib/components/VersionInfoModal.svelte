<script lang="ts">
	import { openExternalURL } from '$lib/utils/external-links';
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';
	import { apiService } from '$lib/services/api.service.svelte';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	const infoIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
		<path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
	</svg>`;

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
			.request({ cmd: 'checkForUpdates' })
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
				error = 'Failed to check for updates';
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

<BaseModal bind:open title="Version Information" icon={infoIcon} size="sm" onClose={handleClose}>
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
				<div class="flex justify-between rounded-lg bg-gray-100 dark:bg-gray-900/50 px-4 py-3">
					<span class="text-gray-600 dark:text-gray-400">Current Version</span>
					<span class="font-mono text-gray-800 dark:text-gray-200"
						>{versionData.currentVersion}</span
					>
				</div>

				<div class="flex justify-between rounded-lg bg-gray-100 dark:bg-gray-900/50 px-4 py-3">
					<span class="text-gray-600 dark:text-gray-400">Latest Version</span>
					<span class="font-mono text-gray-800 dark:text-gray-200">
						{#if versionData.latestVersion}
							<button
								onclick={openReleasesPage}
								class="text-blue-400 hover:text-blue-300 hover:underline"
								title="Open releases page"
							>
								{versionData.latestVersion}
							</button>
							{#if versionData.updateAvailable}
								<span
									class="ml-2 rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-600 dark:text-blue-400"
								>
									Update available
								</span>
							{/if}
						{:else if error}
							<span class="text-gray-500 dark:text-gray-500">Unable to fetch</span>
						{:else}
							<span class="text-gray-500 dark:text-gray-500">Checking...</span>
						{/if}
					</span>
				</div>

				<div class="flex justify-between rounded-lg bg-gray-100 dark:bg-gray-900/50 px-4 py-3">
					<span class="text-gray-600 dark:text-gray-400">Inspektor Gadget Library</span>
					<span class="font-mono text-gray-800 dark:text-gray-200"
						>{versionData.igLibraryVersion}</span
					>
				</div>
			</div>

			{#if error}
				<div
					class="rounded-lg bg-red-100 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400"
				>
					{error}
				</div>
			{/if}

			{#if versionData.updateAvailable}
				<div class="rounded-lg bg-blue-100 dark:bg-blue-900/20 px-4 py-3">
					<p class="text-sm text-blue-700 dark:text-blue-300">
						A new version is available! Click the button below to visit the releases page.
					</p>
				</div>
			{/if}
		{/if}
	</div>

	{#snippet footer()}
		{#if versionData.updateAvailable}
			<Button variant="primary" onclick={openReleasesPage}>View Releases</Button>
		{/if}
		<Button variant="secondary" onclick={checkForUpdates} disabled={loading}>
			{loading ? 'Checking...' : 'Check Again'}
		</Button>
		<Button variant="secondary" onclick={handleClose}>Close</Button>
	{/snippet}
</BaseModal>
