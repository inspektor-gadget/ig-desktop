/**
 * Built-in Plugin Registration
 *
 * Registers all built-in plugins (visualizers, param inputs) with the plugin registry.
 * These plugins are statically imported and have zero compilation overhead.
 */

import { pluginRegistry } from '$lib/services/plugin-registry.service.svelte';

// Import visualizers
import {
	tableManifest,
	Table,
	chartManifest,
	Chart,
	flamegraphManifest,
	Flamegraph,
	histogramManifest,
	Histogram,
	networkMapManifest,
	NetworkMap
} from './visualizers';

// Import param inputs
import {
	k8sAutocompleteManifest,
	K8sAutocomplete,
	filterManifest,
	Filter,
	sortManifest,
	Sort,
	annotationManifest,
	Annotation
} from './params';

/**
 * Register all built-in plugins with the registry.
 * Should be called early in app initialization.
 */
export function registerBuiltinPlugins(): void {
	// Register visualizer plugins
	pluginRegistry.registerBuiltinPlugin(tableManifest, {
		visualizers: { table: Table }
	});

	pluginRegistry.registerBuiltinPlugin(chartManifest, {
		visualizers: { chart: Chart }
	});

	pluginRegistry.registerBuiltinPlugin(flamegraphManifest, {
		visualizers: { flamegraph: Flamegraph }
	});

	pluginRegistry.registerBuiltinPlugin(histogramManifest, {
		visualizers: { histogram: Histogram }
	});

	pluginRegistry.registerBuiltinPlugin(networkMapManifest, {
		visualizers: { networkmap: NetworkMap }
	});

	// Register param input plugins
	pluginRegistry.registerBuiltinPlugin(k8sAutocompleteManifest, {
		paramInputs: { 'k8s-autocomplete': K8sAutocomplete }
	});

	pluginRegistry.registerBuiltinPlugin(filterManifest, {
		paramInputs: { filter: Filter }
	});

	pluginRegistry.registerBuiltinPlugin(sortManifest, {
		paramInputs: { sort: Sort }
	});

	pluginRegistry.registerBuiltinPlugin(annotationManifest, {
		paramInputs: { annotation: Annotation }
	});
}

// Re-export manifests for reference
export {
	tableManifest,
	chartManifest,
	flamegraphManifest,
	histogramManifest,
	networkMapManifest
} from './visualizers';

export {
	k8sAutocompleteManifest,
	filterManifest,
	sortManifest,
	annotationManifest
} from './params';
