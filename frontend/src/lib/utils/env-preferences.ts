/**
 * Environment-scoped preferences utilities
 *
 * Standard pattern for storing preferences that are tied to specific environments.
 * Uses the key pattern: env:{environmentID}:key
 *
 * This allows for automatic cleanup when environments are deleted.
 */

import { preferences } from '$lib/shared/preferences.svelte';

/**
 * Get all localStorage keys for a specific environment
 */
export function getEnvKeys(environmentID: string): string[] {
	const prefix = `env:${environmentID}:`;
	return Object.keys(localStorage).filter((key) => key.startsWith(prefix));
}

/**
 * Get an environment-scoped preference value
 */
export function getEnvPref<T = any>(environmentID: string, key: string): T | undefined {
	const fullKey = `env:${environmentID}:${key}`;
	const value = localStorage.getItem(fullKey);
	if (value === null) return undefined;
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
}

/**
 * Set an environment-scoped preference value
 */
export function setEnvPref(environmentID: string, key: string, value: any): void {
	const fullKey = `env:${environmentID}:${key}`;
	localStorage.setItem(fullKey, JSON.stringify(value));

	// Dispatch custom event for same-window reactivity
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('envPrefChange', { detail: { key: fullKey } }));
	}
}

/**
 * Delete all preferences for a specific environment
 * Should be called when an environment is deleted
 */
export function cleanupEnvironment(environmentID: string): void {
	const keys = getEnvKeys(environmentID);
	keys.forEach((key) => {
		localStorage.removeItem(key);
	});
	console.log(`[env-preferences] Cleaned up ${keys.length} keys for environment ${environmentID}`);
}

/**
 * Get recent K8s resource values for a specific resource type
 *
 * @param environmentID The environment ID
 * @param resourceType The K8s resource type (e.g., 'namespace', 'pod', 'container')
 * @returns Array of recent values (max 8), most recent first
 */
export function getK8sRecents(environmentID: string, resourceType: string): string[] {
	return getEnvPref<string[]>(environmentID, `k8s-recent:${resourceType}`) || [];
}

/**
 * Save a K8s resource value to the recent list
 * Adds to front, removes duplicates, and limits to 8 entries
 *
 * @param environmentID The environment ID
 * @param resourceType The K8s resource type
 * @param value The value to save
 */
export function saveK8sRecent(environmentID: string, resourceType: string, value: string): void {
	if (!value || value === '') return;

	const recents = getK8sRecents(environmentID, resourceType);
	// Add to front, filter out duplicates, limit to 8
	const updated = [value, ...recents.filter((v) => v !== value)].slice(0, 8);
	setEnvPref(environmentID, `k8s-recent:${resourceType}`, updated);
}

/**
 * Clear all recent K8s values for a specific resource type
 */
export function clearK8sRecents(environmentID: string, resourceType: string): void {
	setEnvPref(environmentID, `k8s-recent:${resourceType}`, []);
}

/**
 * Get recent gadget URLs for a specific environment
 *
 * @param environmentID The environment ID
 * @returns Array of recent URLs (max 10), most recent first
 */
export function getGadgetURLRecents(environmentID: string): string[] {
	return getEnvPref<string[]>(environmentID, 'gadget-url-recent') || [];
}

/**
 * Save a gadget URL to the recent list
 * Adds to front, removes duplicates, and limits to 10 entries
 *
 * @param environmentID The environment ID
 * @param url The gadget URL to save
 */
export function saveGadgetURLRecent(environmentID: string, url: string): void {
	if (!url || url === '') return;

	const recents = getGadgetURLRecents(environmentID);
	// Add to front, filter out duplicates, limit to 10
	const updated = [url, ...recents.filter((v) => v !== url)].slice(0, 10);
	setEnvPref(environmentID, 'gadget-url-recent', updated);
}

/**
 * Deep comparison of two objects
 * Used for comparing gadget run requests
 */
function deepEqual(obj1: any, obj2: any): boolean {
	if (obj1 === obj2) return true;
	if (obj1 == null || obj2 == null) return false;
	if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;

	const keys1 = Object.keys(obj1);
	const keys2 = Object.keys(obj2);

	if (keys1.length !== keys2.length) return false;

	for (const key of keys1) {
		if (!keys2.includes(key)) return false;
		if (!deepEqual(obj1[key], obj2[key])) return false;
	}

	return true;
}

/**
 * Add a gadget run request to history with deduplication
 * If the same gadget with same parameters exists, move it to the top
 * Otherwise add as new entry
 *
 * @param environmentID The environment ID
 * @param request The gadget run request
 * @param maxEntries Maximum number of entries to keep (default: 50)
 */
export function addGadgetToHistory(
	environmentID: string,
	request: any,
	maxEntries: number = 50
): void {
	const historyKey = `env:${environmentID}:gadget-history`;
	const history = (getEnvPref<any[]>(environmentID, 'gadget-history') || []) as any[];

	// Find if this exact gadget+params combination exists
	const existingIndex = history.findIndex((item) => {
		// Compare image and params, ignore timestamp
		return item.image === request.image && deepEqual(item.params, request.params);
	});

	let updated: any[];
	if (existingIndex >= 0) {
		// Exists - remove from current position and add to front with new timestamp
		const existing = history[existingIndex];
		updated = [
			{ ...existing, timestamp: request.timestamp },
			...history.slice(0, existingIndex),
			...history.slice(existingIndex + 1)
		];
	} else {
		// New entry - add to front
		updated = [request, ...history];
	}

	// Limit to maxEntries
	setEnvPref(environmentID, 'gadget-history', updated.slice(0, maxEntries));
}
