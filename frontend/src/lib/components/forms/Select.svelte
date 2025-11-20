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

	/**
	 * Compute select classes based on state
	 */
	const selectClasses = $derived(
		[
			'col-start-1 row-start-1 w-full appearance-none rounded-lg border px-4 py-2 pr-10 text-gray-200 transition-colors',
			'focus:outline-none focus:ring-2',
			error
				? 'border-red-500 bg-red-500/10 focus:border-red-500 focus:ring-red-500/20'
				: 'border-gray-800 bg-gray-900/50 focus:border-blue-500 focus:ring-blue-500/20',
			disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
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

	<div class="grid">
		<!-- Chevron icon -->
		<svg
			class="pointer-events-none relative right-3 z-10 col-start-1 row-start-1 h-5 w-5 self-center justify-self-end text-gray-400"
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
		<select bind:value {disabled} {required} {onchange} class={selectClasses}>
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
		<p class="text-xs text-red-400">{error}</p>
	{/if}
</div>
