/**
 * Sort Param Input Plugin
 *
 * Provides a sort field selector for gadget sort parameters.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

export const manifest: PluginManifest = {
	id: 'builtin:param-sort',
	name: 'Sort',
	version: '1.0.0',
	description: 'Sort field selector',

	paramInputs: [
		{
			id: 'sort',
			component: 'Sort.svelte',
			matchKey: ['sort']
		}
	]
};
