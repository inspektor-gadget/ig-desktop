import { instances } from '$lib/shared/instances.svelte';
import { currentSessionStore } from '$lib/stores/current-session.svelte';
import { configuration } from '$lib/stores/configuration.svelte';
import { EventRingBuffer } from '$lib/utils/ring-buffer';
import type {
	GadgetInfoMessage,
	GadgetEventMessage,
	GadgetLogMessage,
	GadgetQuitMessage,
	GadgetArrayDataMessage
} from '$lib/types';
import { pluginRegistry } from '$lib/services/plugin-registry.service.svelte';
import {
	createProcessorContext,
	drainSyntheticEvents,
	cleanupInstanceState,
	initProcessorState
} from '$lib/services/processor-state.service';
import { PLUGIN_CAPABILITIES } from '$lib/types/plugin-system';
import type { Datasource, DatasourceField } from '$lib/types/charts';
import type { GadgetDatasource } from '$lib/types';

/**
 * Convert GadgetDatasource to Datasource type for processor context.
 */
function toDatasource(gds: GadgetDatasource | undefined, fallbackName: string): Datasource {
	if (!gds) {
		return { name: fallbackName, fields: [] };
	}
	return {
		name: gds.name,
		fields: (gds.fields || []) as DatasourceField[],
		annotations: gds.annotations
	};
}

/** Default max events if not configured */
const DEFAULT_MAX_EVENTS = 10000;

/**
 * Get the configured max events per gadget.
 * Ring buffer capacity is set once at creation time.
 */
function getMaxEvents(): number {
	return (configuration.get('maxEventsPerGadget') as number) || DEFAULT_MAX_EVENTS;
}

// ============================================================================
// Data Processor Pipeline
// ============================================================================

/**
 * Run pre-buffer processors on a single event.
 * Returns the processed event, or null if the event should be filtered out.
 */
async function runEventProcessors(
	event: Record<string, unknown>,
	instanceID: string,
	datasource: Datasource
): Promise<Record<string, unknown> | null> {
	const instance = instances[instanceID];
	if (!instance?.gadgetInfo) return event;

	const processors = pluginRegistry.getDataProcessorsForStage('pre-buffer');
	let result: Record<string, unknown> | null = event;

	for (const plugin of processors) {
		if (!plugin.processor?.processEvent) continue;

		// Check if processor applies to this datasource
		if (
			plugin.dataProcessor.appliesTo &&
			!plugin.dataProcessor.appliesTo.includes(datasource.name)
		) {
			continue;
		}

		const ctx = createProcessorContext(
			instanceID,
			plugin.manifest.id,
			datasource,
			instance.gadgetInfo,
			PLUGIN_CAPABILITIES[plugin.source]
		);

		try {
			const processed = await plugin.processor.processEvent(result!, ctx);
			if (processed === null) {
				return null; // Event filtered out
			}
			if (processed !== undefined) {
				result = processed;
			}
		} catch (err) {
			console.error(`Processor ${plugin.manifest.id} error:`, err);
		}
	}

	return result;
}

/**
 * Run pre-buffer processors on a batch of events.
 * Returns the processed events array (may be filtered/transformed).
 */
async function runBatchProcessors(
	events: Record<string, unknown>[],
	instanceID: string,
	datasource: Datasource
): Promise<Record<string, unknown>[]> {
	const instance = instances[instanceID];
	if (!instance?.gadgetInfo) return events;

	const processors = pluginRegistry.getDataProcessorsForStage('pre-buffer');
	let result = events;

	for (const plugin of processors) {
		// Check if processor applies to this datasource
		if (
			plugin.dataProcessor.appliesTo &&
			!plugin.dataProcessor.appliesTo.includes(datasource.name)
		) {
			continue;
		}

		const ctx = createProcessorContext(
			instanceID,
			plugin.manifest.id,
			datasource,
			instance.gadgetInfo,
			PLUGIN_CAPABILITIES[plugin.source]
		);

		try {
			if (plugin.processor?.processBatch) {
				result = await plugin.processor.processBatch(result, ctx);
			} else if (plugin.processor?.processEvent) {
				// Fall back to per-event processing
				const processed: Record<string, unknown>[] = [];
				for (const event of result) {
					const p = await plugin.processor.processEvent(event, ctx);
					if (p !== null && p !== undefined) {
						processed.push(p);
					} else if (p === undefined) {
						processed.push(event); // Pass through unchanged
					}
					// null means filter out
				}
				result = processed;
			}
		} catch (err) {
			console.error(`Processor ${plugin.manifest.id} error:`, err);
		}
	}

	return result;
}

/**
 * Initialize processors for a new gadget instance.
 * Calls onStart for all applicable processors.
 */
async function initializeProcessors(instanceID: string): Promise<void> {
	const instance = instances[instanceID];
	if (!instance?.gadgetInfo) return;

	const processors = pluginRegistry.getDataProcessorsForStage('pre-buffer');

	for (const plugin of processors) {
		if (!plugin.processor?.onStart) continue;

		initProcessorState(instanceID, plugin.manifest.id);

		// Create context with first datasource (or empty placeholder)
		const datasources = instance.gadgetInfo.datasources || [];
		const ds = toDatasource(datasources[0], 'default');

		const ctx = createProcessorContext(
			instanceID,
			plugin.manifest.id,
			ds,
			instance.gadgetInfo,
			PLUGIN_CAPABILITIES[plugin.source]
		);

		try {
			await plugin.processor.onStart(ctx);
		} catch (err) {
			console.error(`Processor ${plugin.manifest.id} onStart error:`, err);
		}
	}
}

/**
 * Cleanup processors when a gadget stops.
 * Calls onStop for all applicable processors.
 */
async function cleanupProcessors(instanceID: string): Promise<void> {
	const instance = instances[instanceID];
	if (!instance?.gadgetInfo) return;

	const processors = pluginRegistry.getDataProcessorsForStage('pre-buffer');

	for (const plugin of processors) {
		if (!plugin.processor?.onStop) continue;

		const datasources = instance.gadgetInfo.datasources || [];
		const ds = toDatasource(datasources[0], 'default');

		const ctx = createProcessorContext(
			instanceID,
			plugin.manifest.id,
			ds,
			instance.gadgetInfo,
			PLUGIN_CAPABILITIES[plugin.source]
		);

		try {
			await plugin.processor.onStop(ctx);
		} catch (err) {
			console.error(`Processor ${plugin.manifest.id} onStop error:`, err);
		}
	}

	cleanupInstanceState(instanceID);
}

/**
 * Push any synthetic events that were emitted by processors.
 */
function pushSyntheticEvents(instanceID: string): void {
	const instance = instances[instanceID];
	if (!instance?.events) return;

	const syntheticEvents = drainSyntheticEvents(instanceID);
	for (const event of syntheticEvents) {
		event._synthetic = true;
		instance.events.push(event);
		instance.eventCount++;
	}
}

/**
 * Buffer for gadget events to improve performance by batching updates.
 * Events are collected for 25ms then flushed to the ring buffer in one go.
 * Runs data processors on events before storage.
 */
class EventBuffer {
	private buffer: GadgetEventMessage[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private msgID = 0;
	private flushing = false;

	/**
	 * Add an event to the buffer and schedule a flush.
	 * Uses push() instead of unshift() for O(1) performance.
	 */
	addEvent(msg: GadgetEventMessage): void {
		this.buffer.push(msg);
		if (!this.timer && !this.flushing) {
			this.timer = setTimeout(() => {
				this.flush();
			}, 25);
		}
	}

	/**
	 * Flush all buffered events to their respective instances' ring buffers.
	 * Ring buffer automatically handles trimming - no manual slice needed.
	 * Runs data processors on each event before storage.
	 */
	private async flush(): Promise<void> {
		this.timer = null;
		this.flushing = true;

		// Take the current buffer and reset
		const toProcess = this.buffer;
		this.buffer = [];

		// Group events by instance for efficient processing
		const eventsByInstance = new Map<string, GadgetEventMessage[]>();
		for (const msg of toProcess) {
			if (!eventsByInstance.has(msg.instanceID)) {
				eventsByInstance.set(msg.instanceID, []);
			}
			eventsByInstance.get(msg.instanceID)!.push(msg);
		}

		// Process each instance's events
		for (const [instanceID, msgs] of eventsByInstance) {
			const instance = instances[instanceID];
			if (!instance?.events) continue;

			// Get datasource for processors (streaming events typically have datasourceID)
			const datasourceID = (msgs[0].data as Record<string, unknown>)?._datasourceID as string || 'default';
			const gds = instance.gadgetInfo?.datasources?.find((d) => d.name === datasourceID);
			const datasource = toDatasource(gds, datasourceID);

			// Process events in reverse order (newest first for ringbuffer)
			for (let i = msgs.length - 1; i >= 0; i--) {
				const msg = msgs[i];
				const processed = await runEventProcessors(
					msg.data as Record<string, unknown>,
					instanceID,
					datasource
				);

				if (processed !== null) {
					instance.events.push(processed);
					instance.eventCount++;
				}
			}

			// Push any synthetic events emitted by processors
			pushSyntheticEvents(instanceID);
		}

		this.flushing = false;

		// If more events arrived during processing, schedule another flush
		if (this.buffer.length > 0 && !this.timer) {
			this.timer = setTimeout(() => {
				this.flush();
			}, 25);
		}
	}

	/**
	 * Get next message ID for event tracking.
	 */
	getNextMsgID(): number {
		return this.msgID++;
	}
}

const eventBuffer = new EventBuffer();

/** Counter for unique batch IDs across array datasource messages */
let batchIdCounter = 0;

/**
 * Snapshot storage for array datasources.
 * Maps instanceID -> datasourceID -> array of snapshots (newest first).
 * Each snapshot contains the raw array data and metadata.
 *
 * Using $state for reactivity so components can detect changes.
 */
export interface ArraySnapshot {
	batchId: number;
	receivedAt: number;
	data: Record<string, unknown>[];
}

interface SnapshotStore {
	[instanceID: string]: {
		[datasourceID: string]: ArraySnapshot[];
	};
}

/** Reactive snapshot storage */
export const arraySnapshotsStore = $state<SnapshotStore>({});

/** Get snapshots for a specific instance and datasource (reactive) */
export function getArraySnapshots(instanceID: string, datasourceID: string): ArraySnapshot[] {
	return arraySnapshotsStore[instanceID]?.[datasourceID] ?? [];
}

/**
 * Handle new gadget info (type 2).
 * Creates a new instance entry when a gadget starts.
 * Uses EventRingBuffer for O(1) event storage with automatic trimming.
 */
export function handleGadgetInfo(msg: GadgetInfoMessage): void {
	const sessionInfo = msg.sessionInfo;

	instances[msg.instanceID] = {
		name: msg.instanceName || msg.data?.imageName || 'Unknown Gadget',
		running: true,
		gadgetInfo: msg.data,
		events: new EventRingBuffer(getMaxEvents()),
		logs: [],
		environment: msg.environmentID || '',
		startTime: Date.now(),
		eventCount: 0,
		session: sessionInfo,
		attached: msg.attached || false
	};

	// Initialize snapshot storage for this instance
	arraySnapshotsStore[msg.instanceID] = {};

	// Store session for single-session-per-start mode
	if (sessionInfo?.isNew && msg.environmentID) {
		currentSessionStore.set(msg.environmentID, sessionInfo.sessionId);
	}

	// Initialize data processors for this instance
	initializeProcessors(msg.instanceID);
}

/**
 * Handle individual gadget event (type 3).
 * Events are buffered and flushed every 25ms for performance.
 */
export function handleGadgetEvent(msg: GadgetEventMessage): void {
	eventBuffer.addEvent(msg);
}

/**
 * Handle gadget logging messages (type 4).
 * Appends log entries to the instance's log array.
 */
export function handleGadgetLogging(msg: GadgetLogMessage): void {
	if (instances[msg.instanceID]) {
		instances[msg.instanceID].logs.push(msg.data);
	}
}

/**
 * Handle gadget quit (type 5).
 * Marks the instance as no longer running.
 */
export function handleGadgetQuit(msg: GadgetQuitMessage): void {
	if (instances[msg.instanceID]) {
		instances[msg.instanceID].running = false;

		// Cleanup data processors for this instance
		cleanupProcessors(msg.instanceID);
	}
}

/**
 * Handle bulk gadget event data (type 6).
 * Processes an array of events at once instead of individually.
 *
 * Two storage mechanisms:
 * 1. Snapshots: Store each array as a snapshot for table navigation (newest first)
 * 2. Ring buffer: Accumulate all events for chart time-series visualization
 *
 * Adds _receivedAt timestamp and _batchId for chart time tracking.
 * Runs data processors on events before storage.
 */
export async function handleGadgetArrayData(msg: GadgetArrayDataMessage): Promise<void> {
	const instance = instances[msg.instanceID];
	if (!instance) return;

	let events = msg.data;
	const datasourceID = msg.datasourceID || 'default';
	const batchId = batchIdCounter++;
	const receivedAt = Date.now();
	const maxEvents = getMaxEvents();

	// Find the datasource metadata for processors
	const gds = instance.gadgetInfo?.datasources?.find((d) => d.name === datasourceID);
	const datasource = toDatasource(gds, datasourceID);

	// Run data processors on the batch
	events = await runBatchProcessors(events, msg.instanceID, datasource);

	// If all events were filtered out, still need to handle synthetic events
	if (events.length === 0) {
		pushSyntheticEvents(msg.instanceID);
		return;
	}

	// Use existing buffer or create new one if not present
	if (!instance.events) {
		instance.events = new EventRingBuffer<Record<string, unknown>>(maxEvents);
	}

	// Store snapshot for table view (with navigation) - using reactive store
	if (!arraySnapshotsStore[msg.instanceID]) {
		arraySnapshotsStore[msg.instanceID] = {};
	}

	if (!arraySnapshotsStore[msg.instanceID][datasourceID]) {
		arraySnapshotsStore[msg.instanceID][datasourceID] = [];
	}

	const existingSnapshots = arraySnapshotsStore[msg.instanceID][datasourceID];

	// Create new snapshot with processed events
	const newSnapshot: ArraySnapshot = {
		batchId,
		receivedAt,
		data: events.map((e) => ({ ...e })) // Clone to avoid mutation
	};

	// Build new array with snapshot at beginning (newest first)
	let newSnapshots = [newSnapshot, ...existingSnapshots];

	// Enforce entry limits across all snapshots
	// Count total entries and trim old snapshots if needed
	let totalEntries = 0;
	let trimIndex = newSnapshots.length;
	for (let i = 0; i < newSnapshots.length; i++) {
		totalEntries += newSnapshots[i].data.length;
		if (totalEntries > maxEvents) {
			trimIndex = i;
			break;
		}
	}
	if (trimIndex < newSnapshots.length) {
		newSnapshots = newSnapshots.slice(0, trimIndex);
	}

	// Assign new array to trigger Svelte reactivity
	arraySnapshotsStore[msg.instanceID][datasourceID] = newSnapshots;

	// Push all events to ring buffer with batch metadata (for chart accumulation)
	for (const event of events) {
		event.msgID = eventBuffer.getNextMsgID();
		event._receivedAt = receivedAt; // When this batch was received (shared timestamp)
		event._batchId = batchId; // Links events from same snapshot
		event._datasourceID = datasourceID;
		instance.events.push(event);
	}

	instance.eventCount += events.length;

	// Push any synthetic events emitted by processors
	pushSyntheticEvents(msg.instanceID);
}
