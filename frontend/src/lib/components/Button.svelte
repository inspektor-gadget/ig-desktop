<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Reusable button component with variants and sizes.
	 *
	 * @example
	 * ```svelte
	 * <Button variant="primary" onclick={handleClick}>
	 *   Save Changes
	 * </Button>
	 *
	 * <Button variant="danger" size="sm" disabled>
	 *   Delete
	 * </Button>
	 * ```
	 */
	interface Props {
		/** Button style variant */
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		/** Button size */
		size?: 'sm' | 'md' | 'lg';
		/** Disabled state */
		disabled?: boolean;
		/** Loading state (shows spinner, disables button) */
		loading?: boolean;
		/** Full width button */
		fullWidth?: boolean;
		/** Button type attribute */
		type?: 'button' | 'submit' | 'reset';
		/** Click handler */
		onclick?: (e: MouseEvent) => void;
		/** Button content */
		children?: Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		disabled = false,
		loading = false,
		fullWidth = false,
		type = 'button',
		onclick,
		children
	}: Props = $props();

	/**
	 * Variant class mappings
	 */
	const variantClasses = {
		primary:
			'bg-blue-500 text-white hover:bg-blue-400 focus:ring-blue-500/50 disabled:bg-blue-500/50',
		secondary:
			'bg-gray-900/50 text-gray-300 border border-gray-800 hover:bg-gray-900 hover:border-gray-700 focus:ring-gray-500/50 disabled:bg-gray-900/30 disabled:text-gray-500',
		danger: 'bg-red-500 text-white hover:bg-red-400 focus:ring-red-500/50 disabled:bg-red-500/50',
		ghost:
			'bg-transparent text-gray-300 hover:bg-gray-800 focus:ring-gray-500/50 disabled:text-gray-600'
	};

	/**
	 * Size class mappings
	 */
	const sizeClasses = {
		sm: 'px-3 py-1.5 text-xs',
		md: 'px-4 py-2 text-sm',
		lg: 'px-6 py-3 text-base'
	};

	/**
	 * Compute final button classes
	 */
	const buttonClasses = $derived(
		[
			'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all',
			'focus:outline-none focus:ring-2',
			'disabled:cursor-not-allowed disabled:opacity-50',
			variantClasses[variant],
			sizeClasses[size],
			fullWidth ? 'w-full' : ''
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<button {type} class={buttonClasses} disabled={disabled || loading} {onclick}>
	{#if loading}
		<svg
			class="h-4 w-4 animate-spin"
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
		>
			<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
			></circle>
			<path
				class="opacity-75"
				fill="currentColor"
				d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
			></path>
		</svg>
	{/if}
	{#if children}
		{@render children()}
	{/if}
</button>
