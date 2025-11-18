import { apiService } from '../services/api.service.svelte';

/**
 * Handle request/response messages (type 1).
 * These messages contain responses to API requests made via apiService.request().
 */
export function handleRequestResponse(msg: any): void {
	apiService.handleResponse(msg);
}
