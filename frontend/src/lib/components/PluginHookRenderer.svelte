<script lang="ts">
	/**
	 * PluginHookRenderer - Renders plugin hooks at designated hook points.
	 *
	 * Usage:
	 *   <PluginHookRenderer hookId="sidebar:navigation" scopes={['local', 'builtin']} />
	 *
	 * This component queries the plugin registry for hooks matching the hookId
	 * and renders them in priority order. Each hook component receives the
	 * provided props.
	 */

	import { pluginRegistry } from '$lib/services/plugin-registry.service.svelte';

	interface Props {
		/** The hook ID to render (e.g., 'sidebar:navigation', 'gadget:toolbar') */
		hookId: string;
		/** Scopes to filter hooks by (default: ['*'] for all) */
		scopes?: string[];
		/** Additional props to pass to each hook component */
		props?: Record<string, unknown>;
	}

	let { hookId, scopes = ['*'], props = {} }: Props = $props();

	// Get matching hooks from registry, sorted by priority
	const hooks = $derived(pluginRegistry.getHooksForId(hookId, scopes));
</script>

{#each hooks as hook (hook.id)}
	<svelte:component this={hook.component} {...props} {hookId} pluginId={hook.manifest.id} />
{/each}
