import { environments } from '$lib/shared/environments.svelte.js';

/**
 * Handle environment creation (type 100).
 * Adds a new environment to the environments store.
 */
export function handleEnvironmentCreate(msg: any): void {
	if (!msg.data?.id) {
		console.warn('handleEnvironmentCreate: missing data.id', msg);
		return;
	}
	environments[msg.data.id] = msg.data;
}

/**
 * Handle environment deletion (type 101).
 * Removes an environment from the environments store.
 */
export function handleEnvironmentDelete(msg: any): void {
	if (!msg.data?.id) {
		console.warn('handleEnvironmentDelete: missing data.id', msg);
		return;
	}
	delete environments[msg.data.id];
}
