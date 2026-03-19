<script lang="ts">
	/**
	 * Reusable select/dropdown component with custom chevron icon.
	 *
	 * @example
	 * ```svelte
	 * <Select
	 *   bind:value={country}
	 *   options={[
	 *     { value: 'us', label: 'United States' },
	 *     { value: 'ca', label: 'Canada' }
	 *   ]}
	 *   label="Country"
	 * />
	 * ```
	 */
	interface Props {
		/** Selected value (bindable) */
		value?: string;
		/** Options array */
		options: Array<{ value: string; label: string; disabled?: boolean }>;
		/** Placeholder text */
		placeholder?: string;
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
		/** Change handler */
		onchange?: (e: Event) => void;
		/** Additional CSS classes */
		class?: string;
	}

	let {
		value = $bindable(''),
		options,
		placeholder,
		disabled = false,
		error,
		label,
		description,
		required = false,
		onchange,
		class: className = ''
	}: Props = $props();

	// Generate a unique ID for the select element
	const selectId = `select-${Math.random().toString(36).slice(2, 9)}`;

	/**
	 * Compute select classes based on state
	 */
	const selectClasses = $derived(
		[
			'col-start-1 row-start-1 w-full appearance-none rounded-ig-md border px-4 py-2 pr-10 text-ig-text transition-colors',
			'focus:outline-none focus:ring-2',
			error
				? 'border-ig-error bg-ig-error/10 focus:border-ig-error focus:ring-ig-error/20'
				: 'border-ig-border-strong bg-ig-surface-raised focus:border-ig-primary focus:ring-ig-primary-muted',
			disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
			className
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<div class="flex flex-col gap-1.5">
	{#if label}
		<label for={selectId} class="text-sm font-medium text-ig-text-secondary">
			{label}
			{#if required}
				<span class="text-ig-error">*</span>
			{/if}
		</label>
	{/if}

	{#if description && !error}
		<p class="text-xs text-ig-text-muted">{description}</p>
	{/if}

	<div class="grid">
		<!-- Chevron icon -->
		<svg
			class="pointer-events-none relative right-3 z-10 col-start-1 row-start-1 h-5 w-5 self-center justify-self-end text-ig-text-muted"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
		>
			<path
				fill-rule="evenodd"
				d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
				clip-rule="evenodd"
			/>
		</svg>

		<!-- Select element -->
		<select id={selectId} bind:value {disabled} {required} {onchange} class={selectClasses}>
			{#if placeholder}
				<option value="" disabled selected>{placeholder}</option>
			{/if}
			{#each options as option}
				<option value={option.value} disabled={option.disabled}>
					{option.label}
				</option>
			{/each}
		</select>
	</div>

	{#if error}
		<p class="text-xs text-ig-error">{error}</p>
	{/if}
</div>
