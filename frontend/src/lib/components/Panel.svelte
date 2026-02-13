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
		 * Color theme for the panel (affects border, icon, and hover states).
		 * Use 'accent' to follow the IG theme's primary color.
		 * @default 'blue'
		 */
		color?: 'blue' | 'purple' | 'green' | 'red' | 'orange' | 'gray' | 'accent';
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

	// Explicit color class map (avoids dynamic template strings for Tailwind class detection)
	const colorMap: Record<string, { border: string; shadow: string; icon: string; badge: string }> =
		{
			blue: {
				border: 'hover:border-blue-500/50',
				shadow: 'hover:shadow-blue-500/10 shadow-gray-200/90 dark:shadow-gray-950/90',
				icon: 'text-blue-500 dark:text-blue-400',
				badge: 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
			},
			purple: {
				border: 'hover:border-purple-500/50',
				shadow: 'hover:shadow-purple-500/10 shadow-gray-200/90 dark:shadow-gray-950/90',
				icon: 'text-purple-500 dark:text-purple-400',
				badge: 'bg-purple-500/20 text-purple-600 dark:text-purple-400'
			},
			green: {
				border: 'hover:border-green-500/50',
				shadow: 'hover:shadow-green-500/10 shadow-gray-200/90 dark:shadow-gray-950/90',
				icon: 'text-green-500 dark:text-green-400',
				badge: 'bg-green-500/20 text-green-600 dark:text-green-400'
			},
			red: {
				border: 'hover:border-red-500/50',
				shadow: 'hover:shadow-red-500/10 shadow-gray-200/90 dark:shadow-gray-950/90',
				icon: 'text-red-500 dark:text-red-400',
				badge: 'bg-red-500/20 text-red-600 dark:text-red-400'
			},
			orange: {
				border: 'hover:border-orange-500/50',
				shadow: 'hover:shadow-orange-500/10 shadow-gray-200/90 dark:shadow-gray-950/90',
				icon: 'text-orange-500 dark:text-orange-400',
				badge: 'bg-orange-500/20 text-orange-600 dark:text-orange-400'
			},
			gray: {
				border: 'hover:border-gray-500/50',
				shadow: 'hover:shadow-gray-500/10 shadow-gray-200/90 dark:shadow-gray-950/90',
				icon: 'text-gray-500 dark:text-gray-400',
				badge: 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
			},
			accent: {
				border: 'hover:border-ig-primary/50',
				shadow: 'hover:shadow-ig-primary/10 shadow-gray-200/90 dark:shadow-gray-950/90',
				icon: 'text-ig-primary',
				badge: 'bg-ig-primary-muted text-ig-primary'
			}
		};
	const colorClasses = $derived(colorMap[color] ?? colorMap.blue);
</script>

<div
	class="group main-gradient flex flex-col rounded-ig-lg border border-ig-border bg-ig-surface transition-all {colorClasses.border} shadow-sm hover:shadow-lg {colorClasses.shadow}"
>
	<!-- Header -->
	<div
		class="flex items-center gap-3 rounded-t-ig-lg border-b border-ig-border bg-ig-surface-raised px-6 py-4"
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
