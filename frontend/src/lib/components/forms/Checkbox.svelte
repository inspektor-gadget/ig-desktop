<script lang="ts">
	/**
	 * Reusable checkbox component.
	 *
	 * @example
	 * ```svelte
	 * <Checkbox
	 *   bind:checked={agreeToTerms}
	 *   label="I agree to the terms and conditions"
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
	 * Handle checkbox change
	 */
	function handleChange(e: Event) {
		const target = e.target as HTMLInputElement;
		checked = target.checked;
		onchange?.(checked);
	}
</script>

<div class="flex items-start gap-3">
	<input
		type="checkbox"
		bind:checked
		{disabled}
		onchange={handleChange}
		class="mt-0.5 h-4 w-4 cursor-pointer rounded border-gray-700 bg-gray-800 text-blue-500 transition-colors focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
	/>

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
