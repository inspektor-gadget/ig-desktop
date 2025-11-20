<script lang="ts">
	/**
	 * Reusable toggle switch component.
	 *
	 * @example
	 * ```svelte
	 * <Toggle
	 *   bind:checked={darkMode}
	 *   label="Dark Mode"
	 *   description="Enable dark theme"
	 * />
	 * ```
	 */
	interface Props {
		/** Checked state (bindable) */
		checked?: boolean;
		/** Disabled state */
		disabled?: boolean;
		/** Label text */
		label?: string;
		/** Description/help text */
		description?: string;
		/** Change handler */
		onchange?: (checked: boolean) => void;
	}

	let {
		checked = $bindable(false),
		disabled = false,
		label,
		description,
		onchange
	}: Props = $props();

	/**
	 * Handle toggle change
	 */
	function handleChange() {
		if (!disabled) {
			checked = !checked;
			onchange?.(checked);
		}
	}

	/**
	 * Compute toggle classes
	 */
	const toggleClasses = $derived(
		[
			'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
			checked ? 'bg-blue-500' : 'bg-gray-700',
			disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
		]
			.filter(Boolean)
			.join(' ')
	);

	/**
	 * Compute toggle dot classes
	 */
	const dotClasses = $derived(
		[
			'inline-block h-4 w-4 rounded-full bg-white transition-transform',
			checked ? 'translate-x-6' : 'translate-x-1'
		].join(' ')
	);
</script>

<div class="flex items-center gap-3">
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		{disabled}
		onclick={handleChange}
		class={toggleClasses}
	>
		<span class={dotClasses}></span>
	</button>

	{#if label || description}
		<div class="flex flex-col gap-0.5">
			{#if label}
				<label class="text-sm font-medium text-gray-300">
					{label}
				</label>
			{/if}
			{#if description}
				<p class="text-xs text-gray-500">{description}</p>
			{/if}
		</div>
	{/if}
</div>
