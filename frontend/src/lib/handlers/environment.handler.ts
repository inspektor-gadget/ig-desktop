import { environments } from '$lib/shared/environments.svelte.js';
import type { Environment } from '$lib/types';

/**
 * Handle environment creation (type 100).
 * Adds a new environment to the environments store.
 */
export function handleEnvironmentCreate(msg: { data?: Environment }): void {
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
export function handleEnvironmentDelete(msg: { data?: { id?: string } }): void {
	if (!msg.data?.id) {
		console.warn('handleEnvironmentDelete: missing data.id', msg);
		return;
	}
	delete environments[msg.data.id];
}
