<script lang="ts">
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';
	import { configuration } from '$lib/stores/configuration.svelte';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	const updateIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
		<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
	</svg>`;

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

<BaseModal bind:open title="Check for Updates" icon={updateIcon} size="sm" onClose={handleDecline}>
	<div class="space-y-4">
		<p class="text-gray-700 dark:text-gray-300">
			Would you like Inspektor Gadget Desktop to automatically check for updates when it starts?
		</p>
		<p class="text-sm text-gray-500 dark:text-gray-500">
			This will connect to GitHub to fetch the latest release information. You can change this
			setting anytime in Settings.
		</p>
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={handleDecline}>No, thanks</Button>
		<Button variant="primary" onclick={handleEnable}>Enable update checks</Button>
	{/snippet}
</BaseModal>
