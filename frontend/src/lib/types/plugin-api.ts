/**
 * Plugin API interfaces for each plugin type.
 *
 * These interfaces define the stable contracts between the core application
 * and plugins, ensuring consistent data exchange with minimal performance overhead.
 */

import type { EventRingBuffer } from '$lib/utils/ring-buffer';
import type { Datasource, DatasourceField } from './charts';
import type { GadgetInfo, GadgetParam, ParamConfig } from './index';
import type { PluginCapabilities } from './plugin-system';

// ============================================================================
// Visualizer Plugin API
// ============================================================================

/**
 * Core props passed to all visualizer plugin components.
 * This is the standardized API that all visualizer plugins receive.
 */
export interface VisualizerPluginProps {
	/** Datasource metadata with fields and annotations */
	ds: Datasource;
	/** Ring buffer of events for streaming datasources */
	events?: EventRingBuffer<Record<string, unknown>> | undefined;
	/** Snapshot data for array datasources */
	snapshotData?: Record<string, unknown>[] | undefined;
	/** Version counter that increments on event updates (for reactivity) */
	eventVersion?: number;
	/** Whether the gadget is currently running */
	isRunning?: boolean;
	/** Unique instance ID for this gadget run */
	instanceID?: string;
	/** Plugin context for accessing app services (optional for builtin components) */
	context?: PluginContext;
}

/**
 * Extended props for visualizers that support search functionality.
 */
export interface SearchableVisualizerProps extends VisualizerPluginProps {
	/** Current search query (if any) */
	searchQuery?: string;
	/** Whether search is in filter mode (vs highlight mode) */
	searchModeFilter?: boolean;
	/** Callback to report search match information */
	onMatchInfo?: (info: SearchMatchInfo) => void;
	/** Index of current highlighted match */
	currentMatchIndex?: number;
}

/**
 * Search match information reported by visualizers.
 */
export interface SearchMatchInfo {
	matchCount: number;
	totalCount: number;
	matchIndices: number[];
}

/**
 * Context object providing access to app services for plugins.
 * Capabilities vary based on plugin source.
 */
export interface PluginContext {
	/** Get a configuration value for this plugin */
	getConfig: <T = unknown>(key: string) => T | undefined;
	/** Set a configuration value for this plugin (if canAccessConfiguration) */
	setConfig: <T = unknown>(key: string, value: T) => void;
	/** Current gadget image name */
	gadgetImage: string;
	/** Full gadget info including params and datasources */
	gadgetInfo: GadgetInfo;
	/** Show a notification to the user */
	showNotification: (message: string, type: 'info' | 'warning' | 'error') => void;
	/** Capabilities available to this plugin */
	capabilities: PluginCapabilities;
}

// ============================================================================
// Data Processor Plugin API
// ============================================================================

/**
 * Exports from a data processor plugin.
 */
export interface DataProcessorExports {
	/**
	 * Process a batch of events.
	 * Called for array datasources when a new batch arrives.
	 * Return the processed events (can filter, transform, or add events).
	 */
	processBatch?(
		events: Record<string, unknown>[],
		ctx: DataProcessorContext
	): Record<string, unknown>[] | Promise<Record<string, unknown>[]>;

	/**
	 * Process a single event.
	 * Called for streaming datasources.
	 * Return the event (possibly modified), null to filter it out, or undefined to pass through.
	 */
	processEvent?(
		event: Record<string, unknown>,
		ctx: DataProcessorContext
	): Record<string, unknown> | null | undefined | Promise<Record<string, unknown> | null | undefined>;

	/**
	 * Called when the gadget starts.
	 * Use for initialization.
	 */
	onStart?(ctx: DataProcessorContext): void | Promise<void>;

	/**
	 * Called when the gadget stops.
	 * Use for cleanup.
	 */
	onStop?(ctx: DataProcessorContext): void | Promise<void>;
}

/**
 * Context passed to data processor functions.
 */
export interface DataProcessorContext {
	/** Name of the datasource being processed */
	datasourceName: string;
	/** Unique instance ID */
	instanceID: string;
	/** Full gadget info */
	gadgetInfo: GadgetInfo;
	/** Datasource metadata */
	datasource: Datasource;

	/**
	 * Get processor-local state.
	 * State persists across events within a single gadget run.
	 */
	getState: <T = unknown>(key: string) => T | undefined;

	/**
	 * Set processor-local state.
	 */
	setState: <T = unknown>(key: string, value: T) => void;

	/**
	 * Emit a synthetic event.
	 * The event will be added to the ringbuffer as if it came from the gadget.
	 */
	emitEvent: (event: Record<string, unknown>) => void;

	/** Plugin capabilities */
	capabilities: PluginCapabilities;
}

// ============================================================================
// Param Input Plugin API
// ============================================================================

/**
 * Props passed to param input plugin components.
 */
export interface ParamInputPluginProps {
	/** The parameter being edited */
	param: GadgetParam;
	/** Configuration object for get/set operations */
	config: ParamConfig;
	/** Context for accessing related data */
	context: ParamInputContext;
}

/**
 * Context for param input plugins.
 */
export interface ParamInputContext {
	/** Get another parameter's current value */
	getParamValue: (key: string) => string | undefined;
	/** Get parameter value by valueHint pattern */
	getParamByValueHint: (hint: string) => string | undefined;
	/** Current environment ID */
	environmentId: string;
	/** Current runtime type (e.g., 'kubernetes', 'docker') */
	runtime: string;
	/** API context for making requests */
	api: ParamInputApiContext;
	/** Plugin capabilities */
	capabilities: PluginCapabilities;
}

/**
 * API context for param input plugins to make requests.
 */
export interface ParamInputApiContext {
	/** Send a request to the backend */
	send: <T = unknown>(type: number, data: unknown) => Promise<T>;
	/** Environment ID for scoped requests */
	environmentId: string;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Plugin bundle containing source files for compilation.
 * Used for local and gadget plugins.
 */
export interface PluginBundle {
	/** Unique identifier */
	id: string;
	/** Display name */
	name: string;
	/** Plugin type */
	type: import('./plugin-system').PluginType;
	/** Source files: path -> source code */
	files: Record<string, string>;
	/** Optional SVG icon */
	icon?: string;
}

/**
 * Cached plugin data stored in IndexedDB.
 */
export interface CachedPlugin {
	/** Cache key (hash of source files) */
	cacheKey: string;
	/** Plugin manifest */
	manifest: import('./plugin-manifest').PluginManifest;
	/** Compiled JavaScript code */
	compiledCode: string;
	/** Combined CSS */
	css?: string;
	/** Timestamp when cached */
	cachedAt: number;
}
