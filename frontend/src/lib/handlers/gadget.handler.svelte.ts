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

/** Default max events if not configured */
const DEFAULT_MAX_EVENTS = 10000;

/**
 * Get the configured max events per gadget.
 * Ring buffer capacity is set once at creation time.
 */
function getMaxEvents(): number {
	return (configuration.get('maxEventsPerGadget') as number) || DEFAULT_MAX_EVENTS;
}

/**
 * Buffer for gadget events to improve performance by batching updates.
 * Events are collected for 25ms then flushed to the ring buffer in one go.
 */
class EventBuffer {
	private buffer: GadgetEventMessage[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private msgID = 0;

	/**
	 * Add an event to the buffer and schedule a flush.
	 * Uses push() instead of unshift() for O(1) performance.
	 */
	addEvent(msg: GadgetEventMessage): void {
		this.buffer.push(msg);
		if (!this.timer) {
			this.timer = setTimeout(() => {
				this.flush();
			}, 25);
		}
	}

	/**
	 * Flush all buffered events to their respective instances' ring buffers.
	 * Ring buffer automatically handles trimming - no manual slice needed.
	 */
	private flush(): void {
		this.timer = null;

		// Process buffer in reverse order since we used push() but want newest first
		for (let i = this.buffer.length - 1; i >= 0; i--) {
			const msg = this.buffer[i];
			if (!instances[msg.instanceID] || !instances[msg.instanceID].events) {
				continue;
			}
			// Ring buffer push() is O(1) and auto-trims
			instances[msg.instanceID].events.push(msg.data);
			instances[msg.instanceID].eventCount++;
		}

		this.buffer = [];
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
 */
export function handleGadgetArrayData(msg: GadgetArrayDataMessage): void {
	const instance = instances[msg.instanceID];
	if (!instance) return;

	const events = msg.data;
	const datasourceID = msg.datasourceID || 'default';
	const batchId = batchIdCounter++;
	const receivedAt = Date.now();
	const maxEvents = getMaxEvents();

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

	// Create new snapshot
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
}
