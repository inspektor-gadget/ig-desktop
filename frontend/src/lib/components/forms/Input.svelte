<script lang="ts">
	/**
	 * Reusable input component with label, description, and error states.
	 *
	 * @example
	 * ```svelte
	 * <Input
	 *   bind:value={email}
	 *   type="email"
	 *   label="Email Address"
	 *   placeholder="you@example.com"
	 *   required
	 * />
	 * ```
	 */
	interface Props {
		/** Input value (bindable) */
		value?: string | number;
		/** Input type */
		type?: 'text' | 'number' | 'email' | 'password' | 'search' | 'url' | 'tel';
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
		/** Input handler */
		oninput?: (e: Event) => void;
		/** Keydown handler */
		onkeydown?: (e: KeyboardEvent) => void;
		/** Blur handler */
		onblur?: (e: FocusEvent) => void;
		/** Additional CSS classes */
		class?: string;
	}

	let {
		value = $bindable(''),
		type = 'text',
		placeholder,
		disabled = false,
		error,
		label,
		description,
		required = false,
		oninput,
		onkeydown,
		onblur,
		class: className = ''
	}: Props = $props();

	// Generate a unique ID for the input element
	const inputId = `input-${Math.random().toString(36).slice(2, 9)}`;

	// Reference to the input element for focus control
	let inputElement: HTMLInputElement | undefined = $state();

	/**
	 * Focus the input element and optionally select all text
	 */
	export function focus(selectAll = false) {
		if (inputElement) {
			inputElement.focus();
			if (selectAll && typeof value === 'string') {
				inputElement.select();
			}
		}
	}

	/**
	 * Compute input classes based on state
	 */
	const inputClasses = $derived(
		[
			'w-full rounded-lg border px-4 py-2 text-gray-800 dark:text-gray-200 transition-colors placeholder:text-gray-400 dark:placeholder:text-gray-500',
			'focus:outline-none focus:ring-2',
			error
				? 'border-red-500 bg-red-500/10 focus:border-red-500 focus:ring-red-500/20'
				: 'border-gray-300 bg-gray-100/50 dark:border-gray-800 dark:bg-gray-900/50 focus:border-blue-500 focus:ring-blue-500/20',
			disabled ? 'cursor-not-allowed opacity-50' : '',
			className
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<div class="flex flex-col gap-1.5">
	{#if label}
		<label for={inputId} class="text-sm font-medium text-gray-700 dark:text-gray-300">
			{label}
			{#if required}
				<span class="text-red-400">*</span>
			{/if}
		</label>
	{/if}

	{#if description && !error}
		<p class="text-xs text-gray-500">{description}</p>
	{/if}

	<input
		bind:this={inputElement}
		id={inputId}
		{type}
		{placeholder}
		{disabled}
		{required}
		bind:value
		{oninput}
		{onkeydown}
		{onblur}
		class={inputClasses}
	/>

	{#if error}
		<p class="text-xs text-red-400">{error}</p>
	{/if}
</div>
