<script lang="ts">
	import { pluginRegistry } from '$lib/services/plugin-registry.service.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import ChevronLeft from '$lib/icons/chevron-left.svg?raw';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	let { data } = $props();

	// Normalize plugin ID (add 'local:' prefix if not prefixed)
	const fullPluginId = $derived(
		data.pluginId.includes(':') ? data.pluginId : `local:${data.pluginId}`
	);

	// Find matching route in plugin registry
	const routeMatch = $derived.by(() => {
		if (!data.pluginId) return null;
		return pluginRegistry.getRouteForPath(fullPluginId, data.routePath);
	});

	// Check if plugin is registered but still loading
	const plugin = $derived(pluginRegistry.get(fullPluginId));
	const isLoading = $derived(plugin?.status === 'loading');

	// Determine error state
	const error = $derived.by(() => {
		if (!data.pluginId) return 'No plugin ID specified';
		if (!plugin) return `Plugin not found: ${fullPluginId}`;
		if (plugin.status === 'error') return `Plugin error: ${plugin.error}`;
		if (plugin.status === 'ready' && !routeMatch) {
			return `Route not found: ${data.routePath} in plugin ${fullPluginId}`;
		}
		return null;
	});

	function goBack() {
		if (history.length > 1) {
			history.back();
		} else {
			goto(resolve('/'));
		}
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden bg-gray-50/80 dark:bg-gray-950/80">
	{#if isLoading}
		<div class="flex flex-1 items-center justify-center">
			<Spinner message="Loading plugin..." />
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center p-8">
			<div class="max-w-md text-center">
				<div
					class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
				>
					<svg
						class="h-8 w-8 text-red-600 dark:text-red-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
				</div>
				<h2 class="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
					Plugin Route Error
				</h2>
				<p class="mb-6 text-gray-600 dark:text-gray-400">{error}</p>
				<button
					onclick={goBack}
					class="inline-flex items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
				>
					<span class="flex h-4 w-4 [&>svg]:h-full [&>svg]:w-full">{@html ChevronLeft}</span>
					Go Back
				</button>
			</div>
		</div>
	{:else if routeMatch}
		<svelte:component
			this={routeMatch.route.component}
			params={routeMatch.params}
			pluginId={fullPluginId}
			routePath={data.routePath}
		/>
	{:else}
		<div class="flex flex-1 items-center justify-center">
			<Spinner message="Loading..." />
		</div>
	{/if}
</div>
