/**
 * K8s Autocomplete Param Input Plugin
 *
 * Provides autocomplete input for Kubernetes resources like pods,
 * namespaces, containers, etc.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

export const manifest: PluginManifest = {
	id: 'builtin:param-k8s-autocomplete',
	name: 'K8s Autocomplete',
	version: '1.0.0',
	description: 'Autocomplete input for Kubernetes resources',

	paramInputs: [
		{
			id: 'k8s-autocomplete',
			component: 'K8sAutocomplete.svelte',
			matchValueHint: ['k8s:*']
		}
	]
};
