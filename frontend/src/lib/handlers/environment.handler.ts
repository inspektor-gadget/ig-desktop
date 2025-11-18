import { environments } from '$lib/shared/environments.svelte.js';

/**
 * Handle environment creation (type 100).
 * Adds a new environment to the environments store.
 */
export function handleEnvironmentCreate(msg: any): void {
	environments[msg.data.id] = msg.data;
}

/**
 * Handle environment deletion (type 101).
 * Removes an environment from the environments store.
 */
export function handleEnvironmentDelete(msg: any): void {
	delete environments[msg.data.id];
}
