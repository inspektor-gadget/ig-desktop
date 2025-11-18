<script lang="ts">
	import { confirmationModal } from '$lib/stores/confirmation-modal.svelte';

	// Icon for confirmation dialogs
	const questionIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
		<path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
	</svg>`;

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			confirmationModal.handleCancel();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			confirmationModal.handleCancel();
		} else if (e.key === 'Enter') {
			confirmationModal.handleConfirm();
		}
	}
</script>

{#if confirmationModal.isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 text-white"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="confirmation-title"
		tabindex="-1"
	>
		<div
			class="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950 shadow-xl"
		>
			<!-- Modal Header -->
			<div class="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-6 py-4">
				<div class="text-yellow-400">{@html questionIcon}</div>
				<h2 id="confirmation-title" class="flex-1 text-lg font-semibold">
					{confirmationModal.title}
				</h2>
				<button
					onclick={() => confirmationModal.handleCancel()}
					class="cursor-pointer rounded p-1 text-gray-500 transition-all hover:bg-gray-800 hover:text-gray-200"
					title="Cancel"
					aria-label="Cancel"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="2"
						stroke="currentColor"
						class="h-5 w-5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Modal Body -->
			<div class="flex-1 px-6 py-6">
				<p class="text-gray-300">{confirmationModal.message}</p>
			</div>

			<!-- Modal Footer -->
			<div
				class="flex items-center justify-end gap-3 border-t border-gray-800 bg-gray-900/50 px-6 py-4"
			>
				<button
					onclick={() => confirmationModal.handleCancel()}
					class="cursor-pointer rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-2 text-sm text-gray-300 transition-all hover:border-gray-700 hover:bg-gray-900"
				>
					{confirmationModal.cancelLabel}
				</button>
				<button
					onclick={() => confirmationModal.handleConfirm()}
					class="cursor-pointer rounded-lg border border-blue-800 bg-blue-900/20 px-4 py-2 text-sm text-blue-400 transition-all hover:border-blue-500/50 hover:bg-blue-900/40"
					autofocus
				>
					{confirmationModal.confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
