<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Reusable modal component with backdrop, ESC key handling, and customizable slots.
	 *
	 * @example
	 * ```svelte
	 * <BaseModal bind:open={isOpen} title="Settings" icon={cogIcon}>
	 *   <p>Modal content goes here</p>
	 *   {#snippet footer()}
	 *     <Button onclick={handleSave}>Save</Button>
	 *   {/snippet}
	 * </BaseModal>
	 * ```
	 */
	interface Props {
		/** Controls modal visibility (bindable) */
		open?: boolean;
		/** Called when modal is closed */
		onClose?: () => void;
		/** Modal title displayed in header */
		title?: string;
		/** SVG icon string to display in header */
		icon?: string;
		/** Show close button in header (default: true) */
		showCloseButton?: boolean;
		/** Modal size variant */
		size?: 'sm' | 'md' | 'lg' | 'xl';
		/** Background color class for modal container (default: 'bg-gray-950') */
		background?: string;
		/** Header slot for custom header content */
		header?: Snippet;
		/** Footer slot for action buttons */
		footer?: Snippet;
		/** Default slot for modal body content */
		children?: Snippet;
	}

	let {
		open = $bindable(false),
		onClose,
		title,
		icon,
		showCloseButton = true,
		size = 'md',
		background = 'bg-gray-950',
		header,
		footer,
		children
	}: Props = $props();

	/**
	 * Size class mappings for modal container
	 */
	const sizeClasses = {
		sm: 'max-w-md',
		md: 'max-w-2xl',
		lg: 'max-w-4xl',
		xl: 'max-w-6xl'
	};

	/**
	 * Close the modal and trigger onClose callback
	 */
	function closeModal() {
		open = false;
		onClose?.();
	}

	/**
	 * Handle backdrop clicks (close only if clicking the backdrop itself)
	 */
	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			closeModal();
		}
	}

	/**
	 * Handle keyboard events (ESC to close)
	 */
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			closeModal();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={handleBackdropClick}
	>
		<div
			class="flex w-full {sizeClasses[
				size
			]} flex-col rounded-2xl border border-gray-800 {background} shadow-2xl"
		>
			<!-- Header -->
			{#if header}
				{@render header()}
			{:else if title || icon}
				<div class="flex items-center gap-3 border-b border-gray-800 bg-gray-900/50 px-6 py-4">
					{#if icon}
						<div class="flex-shrink-0 text-blue-500">
							{@html icon}
						</div>
					{/if}
					{#if title}
						<h2 class="flex-1 text-xl font-semibold text-gray-100">
							{title}
						</h2>
					{/if}
					{#if showCloseButton}
						<button
							onclick={closeModal}
							class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
							aria-label="Close modal"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-5 w-5"
								viewBox="0 0 20 20"
								fill="currentColor"
							>
								<path
									fill-rule="evenodd"
									d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
									clip-rule="evenodd"
								/>
							</svg>
						</button>
					{/if}
				</div>
			{/if}

			<!-- Body -->
			<div class="flex-1 overflow-y-auto px-6 py-6">
				{#if children}
					{@render children()}
				{/if}
			</div>

			<!-- Footer -->
			{#if footer}
				<div
					class="flex items-center justify-end gap-3 border-t border-gray-800 bg-gray-900/50 px-6 py-4"
				>
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}
