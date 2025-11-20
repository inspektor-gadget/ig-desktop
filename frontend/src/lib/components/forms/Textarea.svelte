<script lang="ts">
	/**
	 * Reusable textarea component with label, description, and error states.
	 *
	 * @example
	 * ```svelte
	 * <Textarea
	 *   bind:value={description}
	 *   label="Description"
	 *   rows={5}
	 *   placeholder="Enter a description..."
	 * />
	 * ```
	 */
	interface Props {
		/** Textarea value (bindable) */
		value?: string;
		/** Placeholder text */
		placeholder?: string;
		/** Number of visible rows */
		rows?: number;
		/** Disabled state */
		disabled?: boolean;
		/** Error message to display */
		error?: string;
		/** Label text */
		label?: string;
		/** Description/help text */
		description?: string;
		/** Required field */
		required?: boolean;
		/** Input handler */
		oninput?: (e: Event) => void;
		/** Additional CSS classes */
		class?: string;
	}

	let {
		value = $bindable(''),
		placeholder,
		rows = 4,
		disabled = false,
		error,
		label,
		description,
		required = false,
		oninput,
		class: className = ''
	}: Props = $props();

	/**
	 * Compute textarea classes based on state
	 */
	const textareaClasses = $derived(
		[
			'w-full rounded-lg border px-4 py-2 text-gray-200 transition-colors placeholder:text-gray-500',
			'focus:outline-none focus:ring-2 resize-y',
			error
				? 'border-red-500 bg-red-500/10 focus:border-red-500 focus:ring-red-500/20'
				: 'border-gray-800 bg-gray-900/50 focus:border-blue-500 focus:ring-blue-500/20',
			disabled ? 'cursor-not-allowed opacity-50' : '',
			className
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<div class="flex flex-col gap-1.5">
	{#if label}
		<label class="text-sm font-medium text-gray-300">
			{label}
			{#if required}
				<span class="text-red-400">*</span>
			{/if}
		</label>
	{/if}

	{#if description && !error}
		<p class="text-xs text-gray-500">{description}</p>
	{/if}

	<textarea {rows} {placeholder} {disabled} {required} bind:value {oninput} class={textareaClasses}
	></textarea>

	{#if error}
		<p class="text-xs text-red-400">{error}</p>
	{/if}
</div>
