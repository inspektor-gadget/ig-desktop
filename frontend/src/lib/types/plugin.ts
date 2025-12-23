/**
 * Types for runtime-compiled plugins.
 *
 * Plugins are bundles of source files that can be compiled and executed at runtime.
 * Different plugin types have different entrypoints and capabilities.
 */

import type { PluginType } from './plugin-system';
import { PLUGIN_ENTRYPOINTS } from './plugin-system';

// Re-export from plugin system modules
export type { PluginType, PluginSource, PluginCapabilities, RegisteredPlugin } from './plugin-system';
export type { PluginStatus } from './plugin-system';
export { PLUGIN_CAPABILITIES, PLUGIN_ENTRYPOINTS } from './plugin-system';
export type {
	PluginManifest,
	VisualizerManifest,
	DataProcessorManifest,
	ParamInputManifest,
	PluginSettingDefinition
} from './plugin-manifest';
export type {
	VisualizerPluginProps,
	PluginContext,
	DataProcessorExports,
	DataProcessorContext,
	ParamInputPluginProps,
	ParamInputContext,
	SearchMatchInfo
} from './plugin-api';

/**
 * A bundle of source files that make up a plugin.
 */
export interface PluginBundle {
	/** Unique identifier for the plugin */
	id: string;
	/** Display name */
	name: string;
	/** Plugin type determines entrypoint and capabilities */
	type: PluginType;
	/** Source files: path -> source code (e.g., "Visualizer.svelte" -> "<script>...") */
	files: Record<string, string>;
	/** Optional SVG icon string */
	icon?: string;
	/** Optional custom entrypoint (defaults to PLUGIN_ENTRYPOINTS[type]) */
	entrypoint?: string;
}

/**
 * A compiled and ready-to-use plugin.
 */
export interface CompiledPlugin {
	/** Unique identifier matching the bundle */
	id: string;
	/** Display name */
	name: string;
	/** Plugin type */
	type: PluginType;
	/** Blob URLs for cleanup (one per compiled file) */
	moduleUrls: string[];
	/** The exported entrypoint (component for visualizers) */
	exports: unknown;
	/** Combined CSS from all components */
	css?: string;
	/** Timestamp when compilation completed */
	compiledAt: number;
	/** Compiled modules for caching (path -> code) */
	compiledModules?: Record<string, string>;
	/** Entrypoint path for caching */
	entrypoint?: string;
}

/**
 * Request to compile a plugin bundle.
 */
export interface PluginCompileRequest {
	type: 'compile-plugin';
	id: string;
	pluginType: PluginType;
	/** Source files: path -> source code */
	files: Record<string, string>;
	/** Entrypoint filename */
	entrypoint: string;
	/** If true, validate imports against allowlist (for gadget plugins) */
	sandboxed?: boolean;
}

/**
 * Result of compiling a single file.
 */
export interface CompiledFile {
	path: string;
	code: string;
	css?: string;
}

/**
 * Response from compiling a plugin bundle.
 */
export interface PluginCompileResponse {
	type: 'compile-plugin-result';
	id: string;
	success: boolean;
	/** Compiled files with transformed imports */
	files?: CompiledFile[];
	/** Entrypoint path */
	entrypoint?: string;
	error?: string;
}

/**
 * Helper to get the entrypoint for a plugin bundle.
 */
export function getPluginEntrypoint(bundle: PluginBundle): string {
	return bundle.entrypoint ?? PLUGIN_ENTRYPOINTS[bundle.type];
}

/**
 * Validate that a plugin bundle has required files.
 */
export function validatePluginBundle(bundle: PluginBundle): string | null {
	const entrypoint = getPluginEntrypoint(bundle);
	if (!bundle.files[entrypoint]) {
		return `Missing entrypoint: ${entrypoint}`;
	}
	return null;
}
