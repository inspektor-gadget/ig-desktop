/**
 * Built-in Visualizer Plugins
 *
 * Exports all built-in visualizer manifests and components.
 */

// Table plugin
export { manifest as tableManifest } from './table/manifest';
export { default as Table } from './table/Table.svelte';

// Chart plugin
export { manifest as chartManifest } from './chart/manifest';
export { default as Chart } from './chart/Chart.svelte';

// Flamegraph plugin
export { manifest as flamegraphManifest } from './flamegraph/manifest';
export { default as Flamegraph } from './flamegraph/Flamegraph.svelte';

// Histogram plugin
export { manifest as histogramManifest } from './histogram/manifest';
export { default as Histogram } from './histogram/Histogram.svelte';

// Network Map plugin
export { manifest as networkMapManifest } from './networkmap/manifest';
export { default as NetworkMap } from './networkmap/NetworkMap.svelte';
