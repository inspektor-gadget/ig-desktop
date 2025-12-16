<script lang="ts">
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';
	import { configuration } from '$lib/stores/configuration.svelte';
	import { analyticsService } from '$lib/services/analytics.service.svelte';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	const analyticsIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
		<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
	</svg>`;

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
	title="Help Improve Inspektor Gadget"
	icon={analyticsIcon}
	size="sm"
	onClose={handleDecline}
>
	<div class="space-y-4">
		<p class="text-gray-700 dark:text-gray-300">
			Would you like to help improve Inspektor Gadget Desktop by sharing anonymous usage data?
		</p>
		<div class="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 p-3 text-sm text-gray-600 dark:text-gray-400">
			<p class="mb-2 font-medium text-gray-700 dark:text-gray-300">What we collect:</p>
			<ul class="ml-4 list-disc space-y-1">
				<li>Which official gadgets you run (only from the Inspektor Gadget project)</li>
			</ul>
			<p class="mt-3 mb-2 font-medium text-gray-700 dark:text-gray-300">What we don't collect:</p>
			<ul class="ml-4 list-disc space-y-1">
				<li>Any personal information</li>
				<li>Third-party gadget URLs</li>
				<li>Parameters or data from gadget runs</li>
			</ul>
		</div>
		<p class="text-sm text-gray-500 dark:text-gray-500">
			You can change this setting anytime in Settings under General.
		</p>
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={handleDecline}>No, thanks</Button>
		<Button variant="primary" onclick={handleEnable}>Enable analytics</Button>
	{/snippet}
</BaseModal>
