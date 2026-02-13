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
		/** Blur handler */
		onblur?: (e: FocusEvent) => void;
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
		onblur,
		class: className = ''
	}: Props = $props();

	// Generate a unique ID for the textarea element
	const textareaId = `textarea-${Math.random().toString(36).slice(2, 9)}`;

	/**
	 * Compute textarea classes based on state
	 */
	const textareaClasses = $derived(
		[
			'w-full rounded-ig-md border px-4 py-2 text-ig-text transition-colors placeholder:text-ig-text-muted',
			'focus:outline-none focus:ring-2 resize-y',
			error
				? 'border-ig-error bg-ig-error/10 focus:border-ig-error focus:ring-ig-error/20'
				: 'border-ig-border-strong bg-ig-surface-raised focus:border-ig-primary focus:ring-ig-primary-muted',
			disabled ? 'cursor-not-allowed opacity-50' : '',
			className
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<div class="flex flex-col gap-1.5">
	{#if label}
		<label for={textareaId} class="text-sm font-medium text-ig-text-secondary">
			{label}
			{#if required}
				<span class="text-ig-error">*</span>
			{/if}
		</label>
	{/if}

	{#if description && !error}
		<p class="text-xs text-ig-text-muted">{description}</p>
	{/if}

	<textarea
		id={textareaId}
		{rows}
		{placeholder}
		{disabled}
		{required}
		bind:value
		{oninput}
		{onblur}
		class={textareaClasses}
	></textarea>

	{#if error}
		<p class="text-xs text-ig-error">{error}</p>
	{/if}
</div>
