<script lang="ts">
	import type { Toast } from '$lib/stores/toast.svelte';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	interface Props {
		toast: Toast;
		onDismiss: (id: string) => void;
	}

	let { toast, onDismiss }: Props = $props();

	// Icon mapping for toast types
	const icons = {
		success: '✓',
		error: '✕',
		info: 'ℹ',
		warning: '⚠'
	};

	// Color schemes for each toast type using semantic tokens where applicable
	const colorSchemes = {
		success: {
			border: 'border-ig-success/50',
			bg: 'bg-ig-success/15',
			text: 'text-ig-text',
			icon: 'text-ig-success',
			button: 'hover:bg-ig-success/20'
		},
		error: {
			border: 'border-ig-error/50',
			bg: 'bg-ig-error/15',
			text: 'text-ig-text',
			icon: 'text-ig-error',
			button: 'hover:bg-ig-error/20'
		},
		info: {
			border: 'border-ig-primary/50',
			bg: 'bg-ig-primary/15',
			text: 'text-ig-text',
			icon: 'text-ig-primary',
			button: 'hover:bg-ig-primary/20'
		},
		warning: {
			border: 'border-ig-warning/50',
			bg: 'bg-ig-warning/15',
			text: 'text-ig-text',
			icon: 'text-ig-warning',
			button: 'hover:bg-ig-warning/20'
		}
	};

	const scheme = $derived(colorSchemes[toast.type]);
</script>

<div
	transition:fly={{ x: 100, duration: 300, easing: quintOut }}
	class="flex items-start gap-3 rounded-ig-md border {scheme.border} {scheme.bg} px-4 py-3 shadow-lg backdrop-blur-md"
>
	<!-- Icon -->
	<div class="flex-shrink-0 text-lg font-bold {scheme.icon}">
		{icons[toast.type]}
	</div>

	<!-- Content -->
	<div class="flex-1 {scheme.text}">
		<p class="text-sm leading-5">{toast.message}</p>
		{#if toast.action}
			<button
				onclick={toast.action.onClick}
				class="mt-2 rounded-ig-sm px-2 py-1 text-xs font-medium {scheme.button} transition-colors"
			>
				{toast.action.label}
			</button>
		{/if}
	</div>

	<!-- Dismiss button -->
	<button
		onclick={() => onDismiss(toast.id)}
		class="flex-shrink-0 {scheme.text} opacity-60 transition-opacity hover:opacity-100"
		title="Dismiss"
	>
		<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M6 18L18 6M6 6l12 12"
			/>
		</svg>
	</button>
</div>
