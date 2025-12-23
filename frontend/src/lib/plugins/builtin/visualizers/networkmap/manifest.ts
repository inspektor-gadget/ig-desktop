/**
 * Network Map Visualizer Plugin
 *
 * The network map visualizer displays network connections as an
 * interactive graph with nodes and edges.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v4m-4.5 3.5L10 12m4 0l2.5 3.5"/></svg>`;

export const manifest: PluginManifest = {
	id: 'builtin:networkmap',
	name: 'Network Map',
	version: '1.0.0',
	description: 'Display network connections as an interactive graph',

	visualizers: [
		{
			id: 'networkmap',
			displayName: 'Network',
			icon,
			component: 'NetworkMap.svelte',
			applicableWhen: {
				// Requires source and destination address fields
				hasField: ['src.addr', 'dst.addr']
			},
			// Medium-high priority
			priority: 70
		}
	]
};
