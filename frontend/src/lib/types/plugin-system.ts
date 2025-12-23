/**
 * Core plugin system types and capability definitions.
 *
 * This module defines the fundamental types for the unified plugin architecture
 * supporting visualizers, data processors, and param input components.
 */

import type { Component } from 'svelte';

/**
 * Supported plugin types.
 * - visualizer: Custom visualization component for gadget data
 * - data-processor: Transform/filter events before or after ringbuffer
 * - param-input: Custom input component for gadget parameters
 */
export type PluginType = 'visualizer' | 'data-processor' | 'param-input';

/**
 * Plugin source determines where the plugin came from and its trust level.
 * - builtin: Pre-bundled with the app, no compilation needed
 * - local: Installed in plugins directory, full access
 * - gadget: From gadget metadata, sandboxed execution
 */
export type PluginSource = 'builtin' | 'local' | 'gadget';

/**
 * Capabilities available to plugins based on their source.
 */
export interface PluginCapabilities {
	/** Can access app configuration via PluginContext */
	canAccessConfiguration: boolean;
	/** Can register custom settings in the configuration UI */
	canRegisterSettings: boolean;
	/** Can modify event data in data processors */
	canModifyEvents: boolean;
	/** Can emit synthetic events in data processors */
	canEmitEvents: boolean;
	/** Runs in sandboxed context with restricted imports */
	sandboxed: boolean;
	/** Requires user approval before loading */
	requiresApproval: boolean;
}

/**
 * Capability matrix by plugin source.
 *
 * Built-in and local plugins have full access.
 * Gadget plugins are sandboxed but can still modify/emit events.
 */
export const PLUGIN_CAPABILITIES: Record<PluginSource, PluginCapabilities> = {
	builtin: {
		canAccessConfiguration: true,
		canRegisterSettings: true,
		canModifyEvents: true,
		canEmitEvents: true,
		sandboxed: false,
		requiresApproval: false
	},
	local: {
		canAccessConfiguration: true,
		canRegisterSettings: true,
		canModifyEvents: true,
		canEmitEvents: true,
		sandboxed: false,
		requiresApproval: false
	},
	gadget: {
		canAccessConfiguration: false,
		canRegisterSettings: false,
		canModifyEvents: true,
		canEmitEvents: true,
		sandboxed: true,
		requiresApproval: true
	}
};

/**
 * Well-known entrypoint filenames for each plugin type.
 */
export const PLUGIN_ENTRYPOINTS: Record<PluginType, string> = {
	visualizer: 'Visualizer.svelte',
	'data-processor': 'Processor.ts',
	'param-input': 'Input.svelte'
};

/**
 * Status of a registered plugin.
 */
export type PluginStatus =
	| 'registered' // Manifest loaded but not yet compiled
	| 'loading' // Compilation in progress
	| 'ready' // Compiled and ready to use
	| 'error' // Failed to compile or load
	| 'disabled'; // Manually disabled by user

/**
 * Type for Svelte components that can be used as visualizers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VisualizerComponent = Component<any, any, any>;

/**
 * A registered plugin in the registry.
 */
export interface RegisteredPlugin {
	/** Plugin manifest with metadata and configuration */
	manifest: import('./plugin-manifest').PluginManifest;
	/** Where the plugin came from */
	source: PluginSource;
	/** Current loading status */
	status: PluginStatus;
	/** Svelte component (for visualizers and param-inputs) */
	component?: VisualizerComponent;
	/** Processor exports (for data-processors) */
	processor?: import('./plugin-api').DataProcessorExports;
	/** Error message if status is 'error' */
	error?: string;
	/** Timestamp when plugin was loaded */
	loadedAt?: number;
	/** Cache key for browser caching (hash of source files) */
	cacheKey?: string;
}
