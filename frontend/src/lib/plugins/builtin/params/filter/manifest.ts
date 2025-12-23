/**
 * Filter Param Input Plugin
 *
 * Provides a multi-filter editor for gadget filter parameters.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

export const manifest: PluginManifest = {
	id: 'builtin:param-filter',
	name: 'Filter',
	version: '1.0.0',
	description: 'Multi-filter editor for gadget filter parameters',

	paramInputs: [
		{
			id: 'filter',
			component: 'Filter.svelte',
			matchKey: ['filter']
		}
	]
};
