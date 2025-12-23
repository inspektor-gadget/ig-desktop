/**
 * Flamegraph Visualizer Plugin
 *
 * The flamegraph visualizer displays stack traces as flame graphs,
 * with stack depth on the Y axis and sample count proportional to width.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`;

export const manifest: PluginManifest = {
	id: 'builtin:flamegraph',
	name: 'Flamegraph',
	version: '1.0.0',
	description: 'Display stack traces as flame graphs for performance analysis',

	visualizers: [
		{
			id: 'flamegraph',
			displayName: 'Flamegraph',
			icon,
			component: 'Flamegraph.svelte',
			applicableWhen: {
				// Requires at least one field with flamegraph.type annotation
				hasFieldAnnotation: {
					'*': { 'flamegraph.type': 'stack' }
				}
			},
			// Highest priority among specialized visualizers
			priority: 90
		}
	]
};
