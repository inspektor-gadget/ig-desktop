/**
 * Plugin Configuration Service
 *
 * Manages configuration settings for plugins.
 * Plugin settings are namespaced as `plugin:{pluginId}:{key}` in the main config store.
 */

import { configuration } from '$lib/stores/configuration.svelte';
import { pluginRegistry } from '$lib/services/plugin-registry.service.svelte';
import { registerPluginCategoriesProvider } from '$lib/config';
import type { Category, Setting } from '$lib/config.types';
import type { PluginSettingDefinition } from '$lib/types/plugin-manifest';
import type { PluginContext } from '$lib/types/plugin-api';
import type { GadgetInfo } from '$lib/types';
import type { PluginCapabilities } from '$lib/types/plugin-system';

/** Prefix for plugin settings in the configuration store */
const PLUGIN_PREFIX = 'plugin:';

/**
 * Get the full configuration key for a plugin setting.
 */
function getPluginSettingKey(pluginId: string, settingKey: string): string {
	return `${PLUGIN_PREFIX}${pluginId}:${settingKey}`;
}

/**
 * Convert a plugin setting definition to a configuration Setting.
 */
function toConfigSetting(pluginId: string, def: PluginSettingDefinition): Setting {
	const key = getPluginSettingKey(pluginId, def.key);

	const base = {
		key,
		title: def.title,
		description: def.description
	};

	switch (def.type) {
		case 'toggle':
			return {
				...base,
				type: 'toggle',
				default: def.default as boolean
			};
		case 'select':
			return {
				...base,
				type: 'select',
				options: def.options || {},
				default: def.default as string
			};
		case 'text':
			return {
				...base,
				type: 'text',
				default: def.default as string
			};
		case 'number':
			return {
				...base,
				type: 'number',
				min: def.min,
				max: def.max,
				step: def.step,
				default: def.default as number
			};
		case 'range':
			return {
				...base,
				type: 'range',
				min: def.min ?? 0,
				max: def.max ?? 100,
				step: def.step ?? 1,
				default: def.default as number
			};
		default:
			return {
				...base,
				type: 'text',
				default: String(def.default)
			};
	}
}

class PluginConfigService {
	/**
	 * Get a plugin setting value.
	 * Returns the stored value or the default from the manifest.
	 */
	get<T = unknown>(pluginId: string, key: string): T | undefined {
		const fullKey = getPluginSettingKey(pluginId, key);
		const stored = configuration.get(fullKey);

		if (stored !== undefined) {
			return stored as T;
		}

		// Fall back to manifest default
		const plugin = pluginRegistry.get(pluginId);
		const settingDef = plugin?.manifest.settings?.find((s) => s.key === key);
		return settingDef?.default as T | undefined;
	}

	/**
	 * Set a plugin setting value.
	 */
	set<T = unknown>(pluginId: string, key: string, value: T): void {
		const fullKey = getPluginSettingKey(pluginId, key);
		configuration.set(fullKey, value as boolean | string | number);
	}

	/**
	 * Reset a plugin setting to its default value.
	 */
	reset(pluginId: string, key: string): void {
		const fullKey = getPluginSettingKey(pluginId, key);
		const plugin = pluginRegistry.get(pluginId);
		const settingDef = plugin?.manifest.settings?.find((s) => s.key === key);

		if (settingDef) {
			configuration.set(fullKey, settingDef.default as boolean | string | number);
		}
	}

	/**
	 * Get all settings for a plugin as a key-value object.
	 */
	getAll(pluginId: string): Record<string, unknown> {
		const plugin = pluginRegistry.get(pluginId);
		if (!plugin?.manifest.settings) return {};

		const result: Record<string, unknown> = {};
		for (const setting of plugin.manifest.settings) {
			result[setting.key] = this.get(pluginId, setting.key);
		}
		return result;
	}

	/**
	 * Get configuration categories for all plugins with settings.
	 * Returns an array of Category objects for the configuration UI.
	 */
	getPluginCategories(): Category[] {
		const pluginsWithSettings = pluginRegistry.getPluginsWithSettings();

		return pluginsWithSettings.map((plugin) => {
			const settings = (plugin.manifest.settings || []).map((def) =>
				toConfigSetting(plugin.manifest.id, def)
			);

			return {
				id: `plugin:${plugin.manifest.id}`,
				name: plugin.manifest.name,
				icon: '🔌',
				settings
			};
		});
	}

	/**
	 * Check if any plugins have configurable settings.
	 */
	hasPluginSettings(): boolean {
		return pluginRegistry.getPluginsWithSettings().length > 0;
	}
}

/** Singleton plugin configuration service */
export const pluginConfig = new PluginConfigService();

// Register the plugin categories provider with the config system
registerPluginCategoriesProvider(() => pluginConfig.getPluginCategories());

/**
 * Create a PluginContext for a specific plugin.
 * Used when rendering external plugin components.
 */
export function createPluginContext(
	pluginId: string,
	gadgetInfo: GadgetInfo,
	capabilities: PluginCapabilities
): PluginContext {
	return {
		getConfig: <T = unknown>(key: string) => pluginConfig.get<T>(pluginId, key),
		setConfig: <T = unknown>(key: string, value: T) => {
			if (capabilities.canAccessConfiguration) {
				pluginConfig.set(pluginId, key, value);
			} else {
				console.warn(`Plugin ${pluginId} does not have permission to set configuration`);
			}
		},
		gadgetImage: gadgetInfo.imageName || '',
		gadgetInfo,
		showNotification: (message: string, type: 'info' | 'warning' | 'error') => {
			// TODO: Integrate with notification system when available
			console.log(`[${type}] ${message}`);
		},
		capabilities
	};
}
