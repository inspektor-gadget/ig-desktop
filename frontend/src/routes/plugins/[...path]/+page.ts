import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	// Parse the path to extract plugin ID and route path
	// URL format: /plugins/{pluginId}/{route-path...}
	// Example: /plugins/demo-routes/demo/item-1
	//   -> pluginId: 'demo-routes'
	//   -> routePath: '/demo/item-1'

	const pathParts = (params.path || '').split('/');
	const pluginId = pathParts[0] || '';
	const routePath = '/' + pathParts.slice(1).join('/');

	return {
		pluginId,
		routePath,
		fullPath: params.path || ''
	};
};
