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
		/** Additional CSS classes */
		class?: string;
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
		class: className = '',
		children
	}: Props = $props();

	/**
	 * Variant class mappings
	 */
	const variantClasses = {
		primary:
			'bg-ig-primary text-ig-text-on-primary hover:bg-ig-primary-hover focus:ring-ig-primary-muted disabled:bg-ig-primary/50',
		secondary:
			'bg-ig-surface-raised text-ig-text-secondary border border-ig-border-strong hover:bg-ig-border hover:border-ig-text-muted focus:ring-ig-primary-muted disabled:bg-ig-surface-raised/30 disabled:text-ig-text-muted',
		danger:
			'bg-ig-error text-ig-text-on-primary hover:bg-ig-error/80 focus:ring-ig-error/50 disabled:bg-ig-error/50',
		ghost:
			'bg-transparent text-ig-text-secondary hover:bg-ig-border focus:ring-ig-primary-muted disabled:text-ig-text-muted'
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
			'inline-flex items-center justify-center gap-2 rounded-ig-md font-medium transition-all',
			'focus:outline-none focus:ring-2',
			'disabled:cursor-not-allowed disabled:opacity-50',
			variantClasses[variant],
			sizeClasses[size],
			fullWidth ? 'w-full' : '',
			className
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
