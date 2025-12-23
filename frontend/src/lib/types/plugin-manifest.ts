/**
 * Plugin manifest types defining plugin metadata and configuration.
 *
 * Each plugin has a manifest that describes its capabilities.
 * A plugin can provide multiple capabilities of different types.
 */

/**
 * A plugin manifest describes a plugin's metadata and capabilities.
 * Plugins can provide multiple visualizers, data processors, param inputs,
 * inspector tabs, and hook handlers.
 */
export interface PluginManifest {
	/** Unique identifier (e.g., 'builtin:table', 'gadget:myimage') */
	id: string;
	/** Display name */
	name: string;
	/** Semantic version (e.g., '1.0.0') */
	version: string;
	/** Optional description */
	description?: string;
	/** Optional author */
	author?: string;
	/** Optional default SVG icon string */
	icon?: string;

	/** Visualizer capabilities provided by this plugin */
	visualizers?: VisualizerCapability[];
	/** Data processor capabilities provided by this plugin */
	dataProcessors?: DataProcessorCapability[];
	/** Param input capabilities provided by this plugin */
	paramInputs?: ParamInputCapability[];
	/** Inspector tab capabilities provided by this plugin */
	inspectorTabs?: InspectorTabCapability[];
	/** Hook handlers provided by this plugin */
	hooks?: PluginHookDefinition[];
	/** Route pages provided by this plugin */
	routes?: RouteCapability[];

	/** Configuration settings for local plugins */
	settings?: PluginSettingDefinition[];
}

/**
 * A visualizer capability provided by a plugin.
 */
export interface VisualizerCapability {
	/** Unique ID within the plugin (e.g., 'table', 'json') */
	id: string;
	/** Display name in tab bar */
	displayName: string;
	/** SVG icon for tab */
	icon: string;
	/** Component file path relative to plugin root */
	component: string;
	/**
	 * Conditions for when this visualizer is applicable.
	 * - Single object: all conditions must match (AND)
	 * - Array: any condition set must match (OR)
	 */
	applicableWhen?: VisualizerConditions | VisualizerConditions[];
	/** Priority for tab ordering (higher = shown first, 0 = fallback) */
	priority?: number;
}

/**
 * Conditions for determining if a visualizer applies to a datasource.
 * Multiple conditions are AND'ed together, but within a condition type,
 * multiple values are OR'ed (any match satisfies).
 */
export interface VisualizerConditions {
	/** Required annotations on datasource or fields (key -> value) */
	hasAnnotation?: Record<string, string>;
	/** Required field names that must exist */
	hasField?: string[];
	/** Required field annotations (fieldPattern -> { annotation: value }) */
	hasFieldAnnotation?: Record<string, Record<string, string>>;
	/** Required field tags (fieldPattern -> tag to match) */
	hasFieldTag?: Record<string, string>;
	/** Datasource type requirement */
	datasourceType?: 'stream' | 'array' | 'any';
}

/**
 * A data processor capability provided by a plugin.
 */
export interface DataProcessorCapability {
	/** Unique ID within the plugin */
	id: string;
	/** Entry point file path relative to plugin root */
	entrypoint: string;
	/** Processing stage */
	stage: 'pre-buffer' | 'post-buffer';
	/** Execution order (lower runs first) */
	order?: number;
	/** Datasource name patterns to apply to (glob-style) */
	appliesTo?: string[];
}

/**
 * A param input capability provided by a plugin.
 */
export interface ParamInputCapability {
	/** Unique ID within the plugin */
	id: string;
	/** Component file path relative to plugin root */
	component: string;
	/** Match parameters by typeHint values */
	matchTypeHint?: string[];
	/** Match parameters by valueHint patterns (supports wildcards) */
	matchValueHint?: string[];
	/** Match parameters by key names */
	matchKey?: string[];
}

/**
 * An inspector tab capability provided by a plugin.
 */
export interface InspectorTabCapability {
	/** Unique ID within the plugin */
	id: string;
	/** Display name in tab bar */
	displayName: string;
	/** SVG icon for tab */
	icon: string;
	/** Component file path relative to plugin root */
	component: string;
	/** Conditions for when this tab is available */
	availableWhen?: InspectorTabConditions;
	/** Tab ordering priority (higher = shown first) */
	priority?: number;
	/** Whether to show in developer mode only */
	developerOnly?: boolean;
}

/**
 * Conditions for inspector tab availability.
 */
export interface InspectorTabConditions {
	/** Requires an inspect snapshot (selected row) */
	requiresInspect?: boolean;
	/** Required datasource annotations */
	hasAnnotation?: Record<string, string>;
	/** Required gadget annotations */
	hasGadgetAnnotation?: Record<string, string>;
}

/**
 * A route page capability provided by a plugin.
 * Plugins can register routes that are rendered via the /plugins/[...path]/ catch-all route.
 */
export interface RouteCapability {
	/** Route path pattern relative to plugin (e.g., '/demo', '/demo/[id]') */
	path: string;
	/** Component file path relative to plugin root */
	component: string;
	/** Display title for navigation/breadcrumbs */
	title?: string;
	/** SVG icon string */
	icon?: string;
}

/**
 * A hook point registration by a plugin.
 */
export interface PluginHookDefinition {
	/** The hook ID this plugin wants to render into (e.g., 'gadget:toolbar') */
	hookId: string;
	/** Component file path relative to plugin root */
	component: string;
	/**
	 * Scopes that are allowed to see this hook content.
	 * - '*' matches any scope
	 * - 'builtin' for builtin plugins
	 * - 'local' for local plugins
	 * - 'gadget:*' for any gadget plugin
	 * - 'gadget:image-name' for specific gadget plugin
	 */
	allowedScopes?: string[];
	/** Priority for ordering multiple hook renderers (higher = rendered first) */
	priority?: number;
}

/**
 * Definition for a plugin setting in the configuration UI.
 */
export interface PluginSettingDefinition {
	/** Setting key (namespaced as plugin:{id}:{key}) */
	key: string;
	/** Display title */
	title: string;
	/** Optional description/help text */
	description?: string;
	/** Setting type */
	type: 'toggle' | 'select' | 'text' | 'number' | 'range';
	/** Default value */
	default: unknown;
	/** Options for select type */
	options?: Record<string, string>;
	/** Minimum value for number/range */
	min?: number;
	/** Maximum value for number/range */
	max?: number;
	/** Step value for number/range */
	step?: number;
}

// ============================================================================
// Legacy type aliases for backwards compatibility during migration
// These will be removed once all plugins are migrated
// ============================================================================

/** @deprecated Use VisualizerCapability instead */
export type VisualizerManifest = Omit<VisualizerCapability, 'id' | 'component'>;

/** @deprecated Use DataProcessorCapability instead */
export type DataProcessorManifest = Omit<DataProcessorCapability, 'id' | 'entrypoint'>;

/** @deprecated Use ParamInputCapability instead */
export type ParamInputManifest = Omit<ParamInputCapability, 'id' | 'component'>;
