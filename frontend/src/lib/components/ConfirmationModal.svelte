<script lang="ts">
	import { confirmationModal } from '$lib/stores/confirmation-modal.svelte';
	import BaseModal from './BaseModal.svelte';
	import Button from './Button.svelte';
	import questionIcon from '$lib/icons/question-circle.svelte';

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
	<p class="text-gray-700 dark:text-gray-300">{confirmationModal.message}</p>

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
