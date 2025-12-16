<script lang="ts">
	import type { Snippet } from 'svelte';

	interface PanelProps {
		/**
		 * Panel title displayed in the header
		 */
		title: string;
		/**
		 * SVG icon markup to display in the header
		 */
		icon?: string;
		/**
		 * Color theme for the panel (affects border, icon, and hover states)
		 * @default 'blue'
		 */
		color?: 'blue' | 'purple' | 'green' | 'red' | 'orange' | 'gray';
		/**
		 * Badge text to display next to the title (e.g., count)
		 */
		badge?: string | number;
		/**
		 * Content snippet for the panel body
		 */
		children: Snippet;
		/**
		 * Optional snippet for header actions (buttons, links, etc.)
		 */
		headerActions?: Snippet;
		/**
		 * Padding size for the body
		 * @default 'default' (p-4)
		 */
		bodyPadding?: 'default' | 'large';
	}

	let {
		title,
		icon,
		color = 'blue',
		badge,
		children,
		headerActions,
		bodyPadding = 'default'
	}: PanelProps = $props();

	// Compute color classes based on the color prop
	const colorClasses = $derived({
		border: `hover:border-${color}-500/50`,
		shadow: `hover:shadow-${color}-500/10 shadow-gray-200/90 dark:shadow-gray-950/90`,
		icon: `text-${color}-500 dark:text-${color}-400`,
		badge: `bg-${color}-500/20 text-${color}-600 dark:text-${color}-400`
	});
</script>

<div
	class="group main-gradient flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 transition-all {colorClasses.border} shadow-sm hover:shadow-lg {colorClasses.shadow}"
>
	<!-- Header -->
	<div
		class="flex items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-gray-100/50 dark:border-gray-800 dark:bg-gray-900/50 px-6 py-4"
	>
		<div class="flex flex-1 items-center gap-3">
			{#if icon}
				<div class={colorClasses.icon}>{@html icon}</div>
			{/if}
			<h2 class="text-lg font-semibold">{title}</h2>
			{#if badge !== undefined}
				<div class="ml-auto rounded-full {colorClasses.badge} px-2.5 py-0.5 text-xs font-medium">
					{badge}
				</div>
			{/if}
		</div>
		{#if headerActions}
			<div class="flex items-center gap-2">
				{@render headerActions()}
			</div>
		{/if}
	</div>

	<!-- Body -->
	<div class="flex flex-1 flex-col gap-2 {bodyPadding === 'large' ? 'p-6' : 'p-4'}">
		{@render children()}
	</div>
</div>
