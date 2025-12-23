/**
 * Plugin Registry Service
 *
 * Central registry for all plugins (built-in, local, and gadget).
 * Provides reactive state and lookup methods for finding applicable plugins.
 *
 * Supports the new array-based manifest format where a single plugin
 * can provide multiple capabilities (visualizers, processors, etc.).
 */

import type {
	PluginSource,
	PluginStatus,
	RegisteredPlugin,
	VisualizerComponent
} from '$lib/types/plugin-system';
import { PLUGIN_CAPABILITIES } from '$lib/types/plugin-system';
import type {
	PluginManifest,
	VisualizerConditions,
	VisualizerCapability,
	ParamInputCapability,
	InspectorTabCapability,
	PluginHookDefinition,
	RouteCapability
} from '$lib/types/plugin-manifest';
import { createRouteMatcher, type RouteMatcher } from '$lib/utils/route-matcher';
import type { DataProcessorExports } from '$lib/types/plugin-api';
import type { Datasource } from '$lib/types/charts';
import type { GadgetParam } from '$lib/types/index';
import { pluginService } from './plugin.service';
import { pluginCache, type CachedPlugin } from './plugin-cache.service';

/**
 * A registered visualizer capability from a plugin.
 */
export interface RegisteredVisualizer {
	/** Full ID: {pluginId}:{visualizerId} */
	id: string;
	/** Parent plugin manifest */
	manifest: PluginManifest;
	/** The visualizer capability definition */
	visualizer: VisualizerCapability;
	/** Plugin source */
	source: PluginSource;
	/** The Svelte component */
	component: VisualizerComponent;
}

/**
 * A registered param input capability from a plugin.
 */
export interface RegisteredParamInput {
	/** Full ID: {pluginId}:{paramInputId} */
	id: string;
	/** Parent plugin manifest */
	manifest: PluginManifest;
	/** The param input capability definition */
	paramInput: ParamInputCapability;
	/** Plugin source */
	source: PluginSource;
	/** The Svelte component */
	component: VisualizerComponent;
}

/**
 * A registered inspector tab capability from a plugin.
 */
export interface RegisteredInspectorTab {
	/** Full ID: {pluginId}:{tabId} */
	id: string;
	/** Parent plugin manifest */
	manifest: PluginManifest;
	/** The inspector tab capability definition */
	inspectorTab: InspectorTabCapability;
	/** Plugin source */
	source: PluginSource;
	/** The Svelte component */
	component: VisualizerComponent;
}

/**
 * A registered hook handler from a plugin.
 */
export interface RegisteredHook {
	/** Full ID: {pluginId}:{hookId} */
	id: string;
	/** Parent plugin manifest */
	manifest: PluginManifest;
	/** The hook definition */
	hook: PluginHookDefinition;
	/** Plugin source */
	source: PluginSource;
	/** The Svelte component */
	component: VisualizerComponent;
}

/**
 * A registered route from a plugin.
 */
export interface RegisteredRoute {
	/** Full ID: {pluginId}:route:{path} */
	id: string;
	/** Parent plugin manifest */
	manifest: PluginManifest;
	/** The route capability definition */
	route: RouteCapability;
	/** Plugin source */
	source: PluginSource;
	/** The Svelte component */
	component: VisualizerComponent;
	/** Compiled route matcher function */
	matcher: RouteMatcher;
}

/**
 * Match a string against a glob-like pattern.
 * Supports * as wildcard.
 */
function matchesPattern(value: string, pattern: string): boolean {
	if (pattern === '*') return true;
	if (pattern.endsWith('*')) {
		return value.startsWith(pattern.slice(0, -1));
	}
	if (pattern.startsWith('*')) {
		return value.endsWith(pattern.slice(1));
	}
	if (pattern.includes('*')) {
		const [prefix, suffix] = pattern.split('*');
		return value.startsWith(prefix) && value.endsWith(suffix);
	}
	return value === pattern;
}

/**
 * Check if a datasource matches visualizer conditions.
 * Multiple condition types are AND'ed together.
 */
function matchesVisualizerConditions(ds: Datasource, conditions: VisualizerConditions): boolean {
	// Check datasource-level annotations
	if (conditions.hasAnnotation) {
		for (const [key, value] of Object.entries(conditions.hasAnnotation)) {
			// Check datasource annotations
			if (ds.annotations?.[key] === value) continue;
			// Check field annotations
			const fieldMatch = ds.fields.some((f) => f.annotations?.[key] === value);
			if (!fieldMatch) return false;
		}
	}

	// Check required fields
	if (conditions.hasField) {
		for (const fieldName of conditions.hasField) {
			if (!ds.fields.some((f) => f.fullName === fieldName || f.name === fieldName)) {
				return false;
			}
		}
	}

	// Check field annotation patterns
	if (conditions.hasFieldAnnotation) {
		for (const [fieldPattern, annotations] of Object.entries(conditions.hasFieldAnnotation)) {
			const matchingFields = ds.fields.filter(
				(f) =>
					matchesPattern(f.fullName, fieldPattern) || matchesPattern(f.name, fieldPattern)
			);
			if (matchingFields.length === 0) return false;

			const hasMatchingField = matchingFields.some((f) =>
				Object.entries(annotations).every(([key, value]) => f.annotations?.[key] === value)
			);
			if (!hasMatchingField) return false;
		}
	}

	// Check field tag patterns
	if (conditions.hasFieldTag) {
		for (const [fieldPattern, tagToMatch] of Object.entries(conditions.hasFieldTag)) {
			const matchingFields = ds.fields.filter(
				(f) =>
					matchesPattern(f.fullName, fieldPattern) || matchesPattern(f.name, fieldPattern)
			);
			if (matchingFields.length === 0) return false;

			const hasMatchingField = matchingFields.some((f) => f.tags?.includes(tagToMatch));
			if (!hasMatchingField) return false;
		}
	}

	return true;
}

/**
 * Get the scope string for a plugin based on its source.
 */
function getPluginScope(source: PluginSource, pluginId: string): string {
	switch (source) {
		case 'builtin':
			return 'builtin';
		case 'local':
			return 'local';
		case 'gadget':
			// Extract gadget image from plugin ID (e.g., 'gadget:myimage:viz' -> 'gadget:myimage')
			const parts = pluginId.split(':');
			if (parts.length >= 2) {
				return `gadget:${parts[1]}`;
			}
			return 'gadget';
		default:
			return 'unknown';
	}
}

class PluginRegistry {
	/** All registered plugins by ID */
	private plugins = $state<Map<string, RegisteredPlugin>>(new Map());

	/** Registered visualizers */
	private _visualizers = $state<Map<string, RegisteredVisualizer>>(new Map());

	/** Registered param inputs */
	private _paramInputs = $state<Map<string, RegisteredParamInput>>(new Map());

	/** Registered inspector tabs */
	private _inspectorTabs = $state<Map<string, RegisteredInspectorTab>>(new Map());

	/** Registered hooks */
	private _hooks = $state<Map<string, RegisteredHook>>(new Map());

	/** Registered routes */
	private _routes = $state<Map<string, RegisteredRoute>>(new Map());

	/** Visualizer list sorted by priority (higher first) */
	readonly visualizers = $derived.by(() => {
		const list = [...this._visualizers.values()];
		return list.sort((a, b) => (b.visualizer.priority ?? 0) - (a.visualizer.priority ?? 0));
	});

	/** Param inputs list */
	readonly paramInputs = $derived.by(() => [...this._paramInputs.values()]);

	/** Inspector tabs list sorted by priority */
	readonly inspectorTabs = $derived.by(() => {
		const list = [...this._inspectorTabs.values()];
		return list.sort((a, b) => (b.inspectorTab.priority ?? 0) - (a.inspectorTab.priority ?? 0));
	});

	/** All hooks grouped by hookId */
	readonly hooksByHookId = $derived.by(() => {
		const map = new Map<string, RegisteredHook[]>();
		for (const hook of this._hooks.values()) {
			const hookId = hook.hook.hookId;
			if (!map.has(hookId)) {
				map.set(hookId, []);
			}
			map.get(hookId)!.push(hook);
		}
		// Sort by priority within each hook group
		for (const [, hooks] of map) {
			hooks.sort((a, b) => (b.hook.priority ?? 0) - (a.hook.priority ?? 0));
		}
		return map;
	});

	/** All routes grouped by plugin ID */
	readonly routesByPluginId = $derived.by(() => {
		const map = new Map<string, RegisteredRoute[]>();
		for (const route of this._routes.values()) {
			const pluginId = route.manifest.id;
			if (!map.has(pluginId)) {
				map.set(pluginId, []);
			}
			map.get(pluginId)!.push(route);
		}
		return map;
	});

	/** All routes list */
	readonly routes = $derived.by(() => [...this._routes.values()]);

	/** Data processor plugins sorted by execution order (legacy support) */
	readonly dataProcessors = $derived.by(() => {
		const list = [...this.plugins.values()].filter(
			(p) => p.manifest.dataProcessors && p.manifest.dataProcessors.length > 0 && p.status === 'ready'
		);
		return list.sort((a, b) => {
			const orderA = a.manifest.dataProcessors?.[0]?.order ?? 0;
			const orderB = b.manifest.dataProcessors?.[0]?.order ?? 0;
			return orderA - orderB;
		});
	});

	/** All plugins (for debugging/admin) */
	readonly all = $derived.by(() => [...this.plugins.values()]);

	/**
	 * Register a built-in plugin with its components.
	 * Supports the new array-based manifest format.
	 */
	registerBuiltinPlugin(
		manifest: PluginManifest,
		components: {
			visualizers?: Record<string, VisualizerComponent>;
			paramInputs?: Record<string, VisualizerComponent>;
			inspectorTabs?: Record<string, VisualizerComponent>;
			hooks?: Record<string, VisualizerComponent>;
			routes?: Record<string, VisualizerComponent>;
			processors?: Record<string, DataProcessorExports>;
		}
	): void {
		// Validate manifest
		this.validateManifest(manifest);

		// Register the plugin itself
		this.plugins.set(manifest.id, {
			manifest,
			source: 'builtin',
			status: 'ready',
			loadedAt: Date.now()
		});

		// Register visualizers
		if (manifest.visualizers && components.visualizers) {
			for (const viz of manifest.visualizers) {
				const component = components.visualizers[viz.id];
				if (!component) {
					console.error(
						`Plugin '${manifest.id}': Missing component for visualizer '${viz.id}'. ` +
						`Expected key '${viz.id}' in components.visualizers.`
					);
					continue;
				}
				const fullId = `${manifest.id}:${viz.id}`;
				this._visualizers.set(fullId, {
					id: fullId,
					manifest,
					visualizer: viz,
					source: 'builtin',
					component
				});
			}
		}

		// Register param inputs
		if (manifest.paramInputs && components.paramInputs) {
			for (const paramInput of manifest.paramInputs) {
				const component = components.paramInputs[paramInput.id];
				if (!component) {
					console.error(
						`Plugin '${manifest.id}': Missing component for param input '${paramInput.id}'. ` +
						`Expected key '${paramInput.id}' in components.paramInputs.`
					);
					continue;
				}
				const fullId = `${manifest.id}:${paramInput.id}`;
				this._paramInputs.set(fullId, {
					id: fullId,
					manifest,
					paramInput,
					source: 'builtin',
					component
				});
			}
		}

		// Register inspector tabs
		if (manifest.inspectorTabs && components.inspectorTabs) {
			for (const tab of manifest.inspectorTabs) {
				const component = components.inspectorTabs[tab.id];
				if (!component) {
					console.error(
						`Plugin '${manifest.id}': Missing component for inspector tab '${tab.id}'. ` +
						`Expected key '${tab.id}' in components.inspectorTabs.`
					);
					continue;
				}
				const fullId = `${manifest.id}:${tab.id}`;
				this._inspectorTabs.set(fullId, {
					id: fullId,
					manifest,
					inspectorTab: tab,
					source: 'builtin',
					component
				});
			}
		}

		// Register hooks
		if (manifest.hooks && components.hooks) {
			for (const hook of manifest.hooks) {
				const component = components.hooks[hook.hookId];
				if (!component) {
					console.error(
						`Plugin '${manifest.id}': Missing component for hook '${hook.hookId}'. ` +
						`Expected key '${hook.hookId}' in components.hooks.`
					);
					continue;
				}
				const fullId = `${manifest.id}:${hook.hookId}`;
				this._hooks.set(fullId, {
					id: fullId,
					manifest,
					hook,
					source: 'builtin',
					component
				});
			}
		}

		// Register routes
		if (manifest.routes && components.routes) {
			for (const route of manifest.routes) {
				const component = components.routes[route.path];
				if (!component) {
					console.error(
						`Plugin '${manifest.id}': Missing component for route '${route.path}'. ` +
						`Expected key '${route.path}' in components.routes.`
					);
					continue;
				}
				const fullId = `${manifest.id}:route:${route.path}`;
				this._routes.set(fullId, {
					id: fullId,
					manifest,
					route,
					source: 'builtin',
					component,
					matcher: createRouteMatcher(route.path)
				});
			}
		}
	}

	/**
	 * Validate a plugin manifest.
	 * Throws descriptive errors for invalid manifests.
	 */
	private validateManifest(manifest: PluginManifest): void {
		if (!manifest.id) {
			throw new Error('PluginError: Manifest missing required field "id"');
		}
		if (!manifest.name) {
			throw new Error(`PluginError: Plugin '${manifest.id}' missing required field "name"`);
		}
		if (!manifest.version) {
			throw new Error(`PluginError: Plugin '${manifest.id}' missing required field "version"`);
		}

		// Validate visualizers
		if (manifest.visualizers) {
			for (let i = 0; i < manifest.visualizers.length; i++) {
				const viz = manifest.visualizers[i];
				if (!viz.id) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' visualizers[${i}] missing required field "id"`
					);
				}
				if (!viz.component) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' visualizers[${i}] (${viz.id}) missing required field "component"`
					);
				}
				if (!viz.displayName) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' visualizers[${i}] (${viz.id}) missing required field "displayName"`
					);
				}
				if (!viz.icon) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' visualizers[${i}] (${viz.id}) missing required field "icon"`
					);
				}
			}
		}

		// Validate param inputs
		if (manifest.paramInputs) {
			for (let i = 0; i < manifest.paramInputs.length; i++) {
				const pi = manifest.paramInputs[i];
				if (!pi.id) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' paramInputs[${i}] missing required field "id"`
					);
				}
				if (!pi.component) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' paramInputs[${i}] (${pi.id}) missing required field "component"`
					);
				}
			}
		}

		// Validate inspector tabs
		if (manifest.inspectorTabs) {
			for (let i = 0; i < manifest.inspectorTabs.length; i++) {
				const tab = manifest.inspectorTabs[i];
				if (!tab.id) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' inspectorTabs[${i}] missing required field "id"`
					);
				}
				if (!tab.component) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' inspectorTabs[${i}] (${tab.id}) missing required field "component"`
					);
				}
			}
		}

		// Validate routes
		if (manifest.routes) {
			for (let i = 0; i < manifest.routes.length; i++) {
				const route = manifest.routes[i];
				if (!route.path) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' routes[${i}] missing required field "path"`
					);
				}
				if (!route.component) {
					throw new Error(
						`PluginError: Plugin '${manifest.id}' routes[${i}] (${route.path}) missing required field "component"`
					);
				}
			}
		}
	}

	/**
	 * Register an external plugin (async, requires compilation).
	 * Supports multi-capability plugins with visualizers, routes, hooks, etc.
	 */
	async registerExternal(
		manifest: PluginManifest,
		source: 'local' | 'gadget',
		files: Record<string, string>
	): Promise<void> {
		// Validate manifest first
		this.validateManifest(manifest);

		// Generate cache key from source files
		const cacheKey = await pluginCache.generateCacheKey(manifest.id, files);

		// Set loading state
		this.plugins.set(manifest.id, {
			manifest,
			source,
			status: 'loading',
			cacheKey
		});

		try {
			// Check cache first
			const cached = await pluginCache.get(cacheKey);
			if (cached) {
				await this.loadFromCache(manifest, source, cached);
				return;
			}

			// Compile the plugin (sandboxed for gadget plugins)
			const sandboxed = source === 'gadget';

			// Collect all unique components to compile
			const componentsToCompile = new Map<string, string>();

			if (manifest.visualizers) {
				for (const v of manifest.visualizers) {
					componentsToCompile.set(v.component, `viz:${v.id}`);
				}
			}
			if (manifest.paramInputs) {
				for (const p of manifest.paramInputs) {
					componentsToCompile.set(p.component, `param:${p.id}`);
				}
			}
			if (manifest.inspectorTabs) {
				for (const t of manifest.inspectorTabs) {
					componentsToCompile.set(t.component, `tab:${t.id}`);
				}
			}
			if (manifest.hooks) {
				for (const h of manifest.hooks) {
					componentsToCompile.set(h.component, `hook:${h.hookId}`);
				}
			}
			if (manifest.routes) {
				for (const r of manifest.routes) {
					componentsToCompile.set(r.component, `route:${r.path}`);
				}
			}

			// Compile each unique component
			const compiledComponents = new Map<string, VisualizerComponent>();

			for (const [componentFile, id] of componentsToCompile) {
				const compiled = await pluginService.compile(
					{
						id: `${manifest.id}:${id}`,
						name: manifest.name,
						type: 'visualizer',
						files,
						icon: manifest.icon,
						entrypoint: componentFile
					},
					sandboxed
				);
				compiledComponents.set(componentFile, compiled.exports as VisualizerComponent);
			}

			// Update plugin status
			this.plugins.set(manifest.id, {
				manifest,
				source,
				status: 'ready',
				loadedAt: Date.now(),
				cacheKey
			});

			// Register visualizers
			if (manifest.visualizers) {
				for (const viz of manifest.visualizers) {
					const component = compiledComponents.get(viz.component);
					if (!component) continue;
					const fullId = `${manifest.id}:${viz.id}`;
					this._visualizers.set(fullId, {
						id: fullId,
						manifest,
						visualizer: viz,
						source,
						component
					});
				}
			}

			// Register param inputs
			if (manifest.paramInputs) {
				for (const pi of manifest.paramInputs) {
					const component = compiledComponents.get(pi.component);
					if (!component) continue;
					const fullId = `${manifest.id}:${pi.id}`;
					this._paramInputs.set(fullId, {
						id: fullId,
						manifest,
						paramInput: pi,
						source,
						component
					});
				}
			}

			// Register inspector tabs
			if (manifest.inspectorTabs) {
				for (const tab of manifest.inspectorTabs) {
					const component = compiledComponents.get(tab.component);
					if (!component) continue;
					const fullId = `${manifest.id}:${tab.id}`;
					this._inspectorTabs.set(fullId, {
						id: fullId,
						manifest,
						inspectorTab: tab,
						source,
						component
					});
				}
			}

			// Register hooks
			if (manifest.hooks) {
				for (const hook of manifest.hooks) {
					const component = compiledComponents.get(hook.component);
					if (!component) continue;
					const fullId = `${manifest.id}:${hook.hookId}`;
					this._hooks.set(fullId, {
						id: fullId,
						manifest,
						hook,
						source,
						component
					});
				}
			}

			// Register routes
			if (manifest.routes) {
				for (const route of manifest.routes) {
					const component = compiledComponents.get(route.component);
					if (!component) continue;
					const fullId = `${manifest.id}:route:${route.path}`;
					this._routes.set(fullId, {
						id: fullId,
						manifest,
						route,
						source,
						component,
						matcher: createRouteMatcher(route.path)
					});
				}
			}

			// Note: Caching for multi-component plugins would need to be enhanced
			// to store all compiled components. For now, skip caching for multi-component plugins.
			if (componentsToCompile.size === 1) {
				const [firstComponent] = componentsToCompile.keys();
				const compiled = await pluginService.compile(
					{
						id: manifest.id,
						name: manifest.name,
						type: 'visualizer',
						files,
						icon: manifest.icon,
						entrypoint: firstComponent
					},
					sandboxed
				);
				this.cacheCompiledPlugin(manifest, cacheKey, files, compiled).catch((err) => {
					console.warn('Failed to cache plugin:', err);
				});
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`Failed to load plugin '${manifest.id}':`, errorMessage);
			this.plugins.set(manifest.id, {
				manifest,
				source,
				status: 'error',
				error: errorMessage
			});
			throw error;
		}
	}

	/**
	 * Load a plugin from cache.
	 */
	private async loadFromCache(
		manifest: PluginManifest,
		source: 'local' | 'gadget',
		cached: CachedPlugin
	): Promise<void> {
		this.plugins.set(manifest.id, {
			manifest,
			source,
			status: 'loading',
			cacheKey: cached.cacheKey
		});

		try {
			// Ensure Svelte runtime is available before executing cached code
			pluginService.ensureRuntimeInitialized();

			// Execute cached modules to get the component
			const { exports } = await this.executeCachedModules(
				manifest.id,
				cached.compiledModules,
				cached.entrypoint
			);

			this.plugins.set(manifest.id, {
				manifest,
				source,
				status: 'ready',
				loadedAt: Date.now(),
				cacheKey: cached.cacheKey
			});

			// Register capabilities from cache
			if (manifest.visualizers?.length) {
				const viz = manifest.visualizers[0];
				const fullId = `${manifest.id}:${viz.id}`;
				this._visualizers.set(fullId, {
					id: fullId,
					manifest,
					visualizer: viz,
					source,
					component: exports as VisualizerComponent
				});
			}
		} catch (error) {
			// Cache corrupted, delete and throw
			await pluginCache.delete(cached.cacheKey);
			throw error;
		}
	}

	/**
	 * Execute cached compiled modules.
	 */
	private async executeCachedModules(
		pluginId: string,
		modules: Record<string, string>,
		entrypoint: string
	): Promise<{ exports: unknown; moduleUrls: string[]; css?: string }> {
		const moduleUrls: string[] = [];

		// Initialize plugin module registry
		if (!(globalThis as Record<string, unknown>).__plugin_modules__) {
			(globalThis as Record<string, unknown>).__plugin_modules__ = {};
		}
		((globalThis as Record<string, unknown>).__plugin_modules__ as Record<string, unknown>)[
			pluginId
		] = {};

		// Execute dependency modules first (everything except entrypoint)
		for (const [path, code] of Object.entries(modules)) {
			if (path === entrypoint) continue;

			const blob = new Blob([code], { type: 'text/javascript' });
			const url = URL.createObjectURL(blob);
			moduleUrls.push(url);

			try {
				await import(/* @vite-ignore */ url);
			} catch (e) {
				moduleUrls.forEach((u) => URL.revokeObjectURL(u));
				throw new Error(`Failed to load cached module ${path}: ${e}`);
			}
		}

		// Execute entrypoint
		const entrypointCode = modules[entrypoint];
		if (!entrypointCode) {
			moduleUrls.forEach((u) => URL.revokeObjectURL(u));
			throw new Error(`Entrypoint not found in cache: ${entrypoint}`);
		}

		const entrypointBlob = new Blob([entrypointCode], { type: 'text/javascript' });
		const entrypointUrl = URL.createObjectURL(entrypointBlob);
		moduleUrls.push(entrypointUrl);

		try {
			const module = await import(/* @vite-ignore */ entrypointUrl);
			return { exports: module.default, moduleUrls };
		} catch (e) {
			moduleUrls.forEach((u) => URL.revokeObjectURL(u));
			throw new Error(`Failed to load cached entrypoint: ${e}`);
		}
	}

	/**
	 * Cache a compiled plugin for future use.
	 */
	private async cacheCompiledPlugin(
		manifest: PluginManifest,
		cacheKey: string,
		files: Record<string, string>,
		compiled: {
			moduleUrls: string[];
			exports: unknown;
			css?: string;
			compiledModules?: Record<string, string>;
			entrypoint?: string;
		}
	): Promise<void> {
		if (!compiled.compiledModules || !compiled.entrypoint) {
			console.warn('Cannot cache plugin without compiled modules');
			return;
		}

		const sourceHash = cacheKey.split(':').pop() || '';

		await pluginCache.set({
			cacheKey,
			manifest,
			compiledModules: compiled.compiledModules,
			css: compiled.css,
			entrypoint: compiled.entrypoint,
			cachedAt: Date.now(),
			sourceHash
		});
	}

	/**
	 * Unregister a plugin by ID.
	 */
	unregister(id: string): void {
		const plugin = this.plugins.get(id);
		if (plugin) {
			// Remove all capabilities from this plugin
			for (const [vizId, viz] of this._visualizers) {
				if (viz.manifest.id === id) {
					this._visualizers.delete(vizId);
				}
			}
			for (const [piId, pi] of this._paramInputs) {
				if (pi.manifest.id === id) {
					this._paramInputs.delete(piId);
				}
			}
			for (const [tabId, tab] of this._inspectorTabs) {
				if (tab.manifest.id === id) {
					this._inspectorTabs.delete(tabId);
				}
			}
			for (const [hookId, hook] of this._hooks) {
				if (hook.manifest.id === id) {
					this._hooks.delete(hookId);
				}
			}
			for (const [routeId, route] of this._routes) {
				if (route.manifest.id === id) {
					this._routes.delete(routeId);
				}
			}
			this.plugins.delete(id);
		}
	}

	/**
	 * Get a plugin by ID.
	 */
	get(id: string): RegisteredPlugin | undefined {
		return this.plugins.get(id);
	}

	/**
	 * Check if a plugin is registered.
	 */
	has(id: string): boolean {
		return this.plugins.has(id);
	}

	/**
	 * Get all visualizers applicable to a datasource.
	 */
	getVisualizersForDatasource(ds: Datasource): RegisteredVisualizer[] {
		return this.visualizers.filter((viz) => {
			const conditions = viz.visualizer.applicableWhen;
			// If no conditions, always applicable
			if (!conditions) return true;

			// Handle array of conditions (OR logic)
			if (Array.isArray(conditions)) {
				if (conditions.length === 0) return true;
				return conditions.some((cond) => matchesVisualizerConditions(ds, cond));
			}

			// Single condition set (AND logic within)
			if (Object.keys(conditions).length === 0) return true;
			return matchesVisualizerConditions(ds, conditions);
		});
	}

	/**
	 * Get the default visualizer for a datasource.
	 * Returns the highest-priority applicable visualizer.
	 */
	getDefaultVisualizerForDatasource(ds: Datasource): RegisteredVisualizer | null {
		const applicable = this.getVisualizersForDatasource(ds);
		return applicable[0] ?? null;
	}

	/**
	 * Get data processors for a specific processing stage.
	 * Returns plugins with data processors matching the stage, sorted by order.
	 */
	getDataProcessorsForStage(
		stage: 'pre-buffer' | 'post-buffer'
	): Array<RegisteredPlugin & { dataProcessor: import('$lib/types/plugin-manifest').DataProcessorCapability }> {
		const result: Array<RegisteredPlugin & { dataProcessor: import('$lib/types/plugin-manifest').DataProcessorCapability }> = [];

		for (const plugin of this.plugins.values()) {
			if (plugin.status !== 'ready' || !plugin.manifest.dataProcessors) continue;

			// Find processors for this stage
			for (const dp of plugin.manifest.dataProcessors) {
				if (dp.stage === stage) {
					result.push({
						...plugin,
						dataProcessor: dp
					});
				}
			}
		}

		// Sort by order (lower runs first)
		return result.sort((a, b) => (a.dataProcessor.order ?? 0) - (b.dataProcessor.order ?? 0));
	}

	/**
	 * Find a param input for a parameter.
	 */
	getParamInputForParam(param: GadgetParam): RegisteredParamInput | null {
		for (const pi of this.paramInputs) {
			const config = pi.paramInput;

			// Check valueHint match (supports wildcards)
			if (config.matchValueHint && param.valueHint) {
				for (const pattern of config.matchValueHint) {
					if (matchesPattern(param.valueHint, pattern)) {
						return pi;
					}
				}
			}

			// Check typeHint match
			if (config.matchTypeHint && param.typeHint) {
				if (config.matchTypeHint.includes(param.typeHint)) {
					return pi;
				}
			}

			// Check key match
			if (config.matchKey && config.matchKey.includes(param.key)) {
				return pi;
			}
		}

		return null;
	}

	/**
	 * Get inspector tabs for the current context.
	 */
	getInspectorTabsForContext(
		hasInspect: boolean,
		developerMode: boolean = false
	): RegisteredInspectorTab[] {
		return this.inspectorTabs.filter((tab) => {
			// Check developer mode
			if (tab.inspectorTab.developerOnly && !developerMode) {
				return false;
			}
			// Check availableWhen conditions
			const conditions = tab.inspectorTab.availableWhen;
			if (conditions?.requiresInspect && !hasInspect) {
				return false;
			}
			// TODO: Check annotation conditions
			return true;
		});
	}

	/**
	 * Get hooks for a specific hook ID that match the given scopes.
	 */
	getHooksForId(hookId: string, activeScopes: string[]): RegisteredHook[] {
		const hooks = this.hooksByHookId.get(hookId) ?? [];
		return hooks.filter((hook) => {
			const allowedScopes = hook.hook.allowedScopes ?? ['*'];

			// Check if any active scope matches any allowed scope
			for (const activeScope of activeScopes) {
				for (const allowedScope of allowedScopes) {
					if (this.scopeMatches(activeScope, allowedScope)) {
						return true;
					}
				}
			}
			return false;
		});
	}

	/**
	 * Find a route matching the given path for a plugin.
	 * Returns the matching route and extracted params, or null if no match.
	 */
	getRouteForPath(
		pluginId: string,
		path: string
	): { route: RegisteredRoute; params: Record<string, string> } | null {
		const pluginRoutes = this.routesByPluginId.get(pluginId) ?? [];

		for (const route of pluginRoutes) {
			const result = route.matcher(path);
			if (result.match) {
				return { route, params: result.params };
			}
		}
		return null;
	}

	/**
	 * Get all routes for a specific plugin.
	 */
	getRoutesForPlugin(pluginId: string): RegisteredRoute[] {
		return this.routesByPluginId.get(pluginId) ?? [];
	}

	/**
	 * Check if an active scope matches an allowed scope pattern.
	 */
	private scopeMatches(actual: string, pattern: string): boolean {
		if (pattern === '*') return true;
		if (pattern.endsWith(':*')) {
			const prefix = pattern.slice(0, -1);
			return actual.startsWith(prefix);
		}
		return actual === pattern;
	}

	/**
	 * Get all plugins with settings (for configuration UI).
	 */
	getPluginsWithSettings(): RegisteredPlugin[] {
		return [...this.plugins.values()].filter(
			(p) =>
				p.source === 'local' &&
				p.manifest.settings &&
				p.manifest.settings.length > 0
		);
	}

	/**
	 * Update plugin status.
	 */
	setStatus(id: string, status: PluginStatus, error?: string): void {
		const plugin = this.plugins.get(id);
		if (plugin) {
			this.plugins.set(id, {
				...plugin,
				status,
				error
			});
		}
	}

	/**
	 * Get count of capabilities by type.
	 */
	getStats(): {
		visualizers: number;
		paramInputs: number;
		inspectorTabs: number;
		hooks: number;
		routes: number;
		plugins: number;
	} {
		return {
			visualizers: this._visualizers.size,
			paramInputs: this._paramInputs.size,
			inspectorTabs: this._inspectorTabs.size,
			hooks: this._hooks.size,
			routes: this._routes.size,
			plugins: this.plugins.size
		};
	}

	/**
	 * Clear all plugins (for testing).
	 */
	clear(): void {
		this.plugins.clear();
		this._visualizers.clear();
		this._paramInputs.clear();
		this._inspectorTabs.clear();
		this._hooks.clear();
		this._routes.clear();
	}
}

/** Singleton plugin registry */
export const pluginRegistry = new PluginRegistry();
