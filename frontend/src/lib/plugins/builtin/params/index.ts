/**
 * Built-in Param Input Plugins
 *
 * Exports all built-in param input manifests and components.
 */

// K8s Autocomplete plugin
export { manifest as k8sAutocompleteManifest } from './k8s-autocomplete/manifest';
export { default as K8sAutocomplete } from './k8s-autocomplete/K8sAutocomplete.svelte';

// Filter plugin
export { manifest as filterManifest } from './filter/manifest';
export { default as Filter } from './filter/Filter.svelte';

// Sort plugin
export { manifest as sortManifest } from './sort/manifest';
export { default as Sort } from './sort/Sort.svelte';

// Annotation plugin
export { manifest as annotationManifest } from './annotation/manifest';
export { default as Annotation } from './annotation/Annotation.svelte';
