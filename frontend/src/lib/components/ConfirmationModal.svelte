<script lang="ts">
	import { confirmationModal } from '$lib/stores/confirmation-modal.svelte';
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';

	// Icon for confirmation dialogs
	const questionIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
		<path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
	</svg>`;

	/**
	 * Handle Enter key for confirmation
	 */
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && confirmationModal.isOpen) {
			confirmationModal.handleConfirm();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<BaseModal
	open={confirmationModal.isOpen}
	title={confirmationModal.title}
	icon={questionIcon}
	size="sm"
	onClose={() => confirmationModal.handleCancel()}
>
	<p class="text-gray-300">{confirmationModal.message}</p>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => confirmationModal.handleCancel()}>
			{confirmationModal.cancelLabel}
		</Button>
		<Button
			variant="primary"
			onclick={() => confirmationModal.handleConfirm()}
			class="border-blue-800 bg-blue-900/20 text-blue-400 hover:border-blue-500/50 hover:bg-blue-900/40"
		>
			{confirmationModal.confirmLabel}
		</Button>
	{/snippet}
</BaseModal>
