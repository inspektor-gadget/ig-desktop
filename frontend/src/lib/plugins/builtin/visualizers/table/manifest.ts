/**
 * Table Visualizer Plugin
 *
 * The table visualizer is the default/fallback visualization.
 * It displays events as rows with columns from datasource fields.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>`;

export const manifest: PluginManifest = {
	id: 'builtin:table',
	name: 'Table',
	version: '1.0.0',
	description: 'Display events in a tabular format with sortable columns',

	visualizers: [
		{
			id: 'table',
			displayName: 'Table',
			icon,
			component: 'Table.svelte',
			// Table is always applicable (fallback visualizer)
			applicableWhen: {},
			// Lowest priority - used when no other visualizer matches
			priority: 0
		}
	]
};
