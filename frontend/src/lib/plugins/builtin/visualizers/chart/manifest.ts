/**
 * Chart/Metrics Visualizer Plugin
 *
 * The chart visualizer displays time-series metrics data as
 * line, area, or bar charts.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>`;

export const manifest: PluginManifest = {
	id: 'builtin:chart',
	name: 'Chart',
	version: '1.0.0',
	description: 'Display metrics as time-series charts (line, area, bar)',

	visualizers: [
		{
			id: 'chart',
			displayName: 'Chart',
			icon,
			component: 'Chart.svelte',
			applicableWhen: {
				// Requires metrics.collect annotation on datasource
				hasAnnotation: {
					'metrics.collect': 'true'
				}
			},
			// Medium priority
			priority: 50
		}
	]
};
