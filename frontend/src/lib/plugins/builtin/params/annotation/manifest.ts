/**
 * Annotation Param Input Plugin
 *
 * Provides an annotation editor for gadget annotate parameters.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

export const manifest: PluginManifest = {
	id: 'builtin:param-annotation',
	name: 'Annotation',
	version: '1.0.0',
	description: 'Annotation editor for gadget annotate parameters',

	paramInputs: [
		{
			id: 'annotation',
			component: 'Annotation.svelte',
			matchKey: ['annotate']
		}
	]
};
