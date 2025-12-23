/**
 * Processor State Service
 *
 * Manages per-instance, per-processor state for data processor plugins.
 * State persists within a single gadget run and is cleaned up when the gadget stops.
 */

import type { Datasource } from '$lib/types/charts';
import type { GadgetInfo } from '$lib/types';
import type { PluginCapabilities } from '$lib/types/plugin-system';
import type { DataProcessorContext } from '$lib/types/plugin-api';

/**
 * State storage structure: instanceID -> processorID -> key -> value
 */
const stateStore = new Map<string, Map<string, Map<string, unknown>>>();

/**
 * Pending synthetic events to be emitted: instanceID -> events[]
 */
const syntheticEventsQueue = new Map<string, Record<string, unknown>[]>();

/**
 * Get processor-local state.
 */
function getState<T = unknown>(
	instanceID: string,
	processorID: string,
	key: string
): T | undefined {
	return stateStore.get(instanceID)?.get(processorID)?.get(key) as T | undefined;
}

/**
 * Set processor-local state.
 */
function setState<T = unknown>(
	instanceID: string,
	processorID: string,
	key: string,
	value: T
): void {
	if (!stateStore.has(instanceID)) {
		stateStore.set(instanceID, new Map());
	}
	const instanceState = stateStore.get(instanceID)!;

	if (!instanceState.has(processorID)) {
		instanceState.set(processorID, new Map());
	}
	instanceState.get(processorID)!.set(key, value);
}

/**
 * Queue a synthetic event to be emitted.
 */
function emitEvent(instanceID: string, event: Record<string, unknown>): void {
	if (!syntheticEventsQueue.has(instanceID)) {
		syntheticEventsQueue.set(instanceID, []);
	}
	syntheticEventsQueue.get(instanceID)!.push(event);
}

/**
 * Drain and return all queued synthetic events for an instance.
 */
export function drainSyntheticEvents(instanceID: string): Record<string, unknown>[] {
	const events = syntheticEventsQueue.get(instanceID) || [];
	syntheticEventsQueue.delete(instanceID);
	return events;
}

/**
 * Clean up all state for an instance (call when gadget stops).
 */
export function cleanupInstanceState(instanceID: string): void {
	stateStore.delete(instanceID);
	syntheticEventsQueue.delete(instanceID);
}

/**
 * Create a DataProcessorContext for a specific processor and instance.
 */
export function createProcessorContext(
	instanceID: string,
	processorID: string,
	datasource: Datasource,
	gadgetInfo: GadgetInfo,
	capabilities: PluginCapabilities
): DataProcessorContext {
	return {
		datasourceName: datasource.name,
		instanceID,
		gadgetInfo,
		datasource,
		getState: <T = unknown>(key: string) => getState<T>(instanceID, processorID, key),
		setState: <T = unknown>(key: string, value: T) => setState(instanceID, processorID, key, value),
		emitEvent: (event: Record<string, unknown>) => emitEvent(instanceID, event),
		capabilities
	};
}

/**
 * Initialize state for a new processor on an instance.
 * Called when a gadget starts and processors are registered.
 */
export function initProcessorState(instanceID: string, processorID: string): void {
	if (!stateStore.has(instanceID)) {
		stateStore.set(instanceID, new Map());
	}
	if (!stateStore.get(instanceID)!.has(processorID)) {
		stateStore.get(instanceID)!.set(processorID, new Map());
	}
}
