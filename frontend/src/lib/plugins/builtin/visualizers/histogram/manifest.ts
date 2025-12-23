/**
 * Histogram Visualizer Plugin
 *
 * The histogram visualizer displays distribution data as histograms,
 * either as bar charts or heatmaps over time.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="12" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/></svg>`;

export const manifest: PluginManifest = {
	id: 'builtin:histogram',
	name: 'Histogram',
	version: '1.0.0',
	description: 'Display distribution data as histograms or heatmaps',

	visualizers: [
		{
			id: 'histogram',
			displayName: 'Histogram',
			icon,
			component: 'Histogram.svelte',
			// Match either annotation OR tag (OR condition with array)
			applicableWhen: [
				// Fields with metrics.type=histogram annotation
				{ hasFieldAnnotation: { '*': { 'metrics.type': 'histogram' } } },
				// Fields with gadget_histogram_slot tag
				{ hasFieldTag: { '*': 'type:gadget_histogram_slot__u32' } }
			],
			// High priority
			priority: 80
		}
	]
};
