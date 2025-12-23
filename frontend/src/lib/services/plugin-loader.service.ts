/**
 * Plugin Loader Service
 *
 * Discovers and loads local plugins from the backend plugins directory.
 * Registers discovered plugins with the plugin registry.
 */

import { apiService, type DiscoveredPlugin } from './api.service.svelte';
import { pluginRegistry } from './plugin-registry.service.svelte';
import { features } from '$lib/config/app-mode';

let initialized = false;
let localPluginsDir = '';

/**
 * Load and register all local plugins from the backend.
 * Should be called after the WebSocket connection is established.
 */
export async function loadLocalPlugins(): Promise<void> {
	if (initialized) return;
	if (!features.hasBackend) {
		console.log('plugin-loader: skipping (no backend)');
		initialized = true;
		return;
	}

	try {
		console.log('plugin-loader: discovering local plugins...');
		const response = await apiService.listPlugins();

		localPluginsDir = response?.pluginsDir ?? '';
		console.log(`plugin-loader: plugins directory: ${localPluginsDir}`);

		const plugins = response?.plugins ?? [];
		console.log(`plugin-loader: found ${plugins.length} local plugin(s)`);

		for (const plugin of plugins) {
			await registerLocalPlugin(plugin);
		}

		initialized = true;
	} catch (error) {
		console.error('plugin-loader: failed to discover plugins:', error);
	}
}

/**
 * Register a discovered local plugin with the plugin registry.
 */
async function registerLocalPlugin(plugin: DiscoveredPlugin): Promise<void> {
	try {
		// Describe what capabilities this plugin provides
		const caps: string[] = [];
		if (plugin.manifest.visualizers?.length) caps.push(`${plugin.manifest.visualizers.length} visualizer(s)`);
		if (plugin.manifest.dataProcessors?.length) caps.push(`${plugin.manifest.dataProcessors.length} processor(s)`);
		if (plugin.manifest.paramInputs?.length) caps.push(`${plugin.manifest.paramInputs.length} param input(s)`);
		if (plugin.manifest.inspectorTabs?.length) caps.push(`${plugin.manifest.inspectorTabs.length} inspector tab(s)`);
		if (plugin.manifest.hooks?.length) caps.push(`${plugin.manifest.hooks.length} hook(s)`);
		if (plugin.manifest.routes?.length) caps.push(`${plugin.manifest.routes.length} route(s)`);
		console.log(`plugin-loader: registering ${plugin.manifest.id} (${caps.join(', ') || 'no capabilities'})`);

		await pluginRegistry.registerExternal(plugin.manifest, 'local', plugin.files);

		console.log(`plugin-loader: registered ${plugin.manifest.id}`);
	} catch (error) {
		console.error(`plugin-loader: failed to register ${plugin.manifest.id}:`, error);
	}
}

/**
 * Get the local plugins directory path.
 */
export function getLocalPluginsDir(): string {
	return localPluginsDir;
}

/**
 * Check if local plugins have been loaded.
 */
export function isInitialized(): boolean {
	return initialized;
}

/**
 * Reload local plugins (for development/refresh).
 */
export async function reloadLocalPlugins(): Promise<void> {
	if (!features.hasBackend) return;

	try {
		console.log('plugin-loader: reloading local plugins...');

		// Get current local plugins
		const currentLocal = pluginRegistry.all.filter((p) => p.source === 'local');
		for (const plugin of currentLocal) {
			pluginRegistry.unregister(plugin.manifest.id);
		}

		// Rediscover and register
		const response = await apiService.listPlugins();
		localPluginsDir = response.pluginsDir;

		for (const plugin of response.plugins) {
			await registerLocalPlugin(plugin);
		}

		console.log(`plugin-loader: reloaded ${response.plugins.length} plugin(s)`);
	} catch (error) {
		console.error('plugin-loader: failed to reload plugins:', error);
	}
}
