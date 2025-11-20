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

	// Color schemes for each toast type
	const colorSchemes = {
		success: {
			border: 'border-green-800',
			bg: 'bg-green-900/90',
			text: 'text-green-100',
			icon: 'text-green-400',
			button: 'hover:bg-green-800/50'
		},
		error: {
			border: 'border-red-800',
			bg: 'bg-red-900/90',
			text: 'text-red-100',
			icon: 'text-red-400',
			button: 'hover:bg-red-800/50'
		},
		info: {
			border: 'border-blue-800',
			bg: 'bg-blue-900/90',
			text: 'text-blue-100',
			icon: 'text-blue-400',
			button: 'hover:bg-blue-800/50'
		},
		warning: {
			border: 'border-yellow-800',
			bg: 'bg-yellow-900/90',
			text: 'text-yellow-100',
			icon: 'text-yellow-400',
			button: 'hover:bg-yellow-800/50'
		}
	};

	const scheme = colorSchemes[toast.type];
</script>

<div
	transition:fly={{ x: 100, duration: 300, easing: quintOut }}
	class="flex items-start gap-3 rounded-lg border {scheme.border} {scheme.bg} px-4 py-3 shadow-lg backdrop-blur-md"
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
				class="mt-2 rounded px-2 py-1 text-xs font-medium {scheme.button} transition-colors"
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
