import { instances } from '$lib/shared/instances.svelte';
import { currentSessionStore } from '$lib/stores/current-session.svelte';
import { configuration } from '$lib/stores/configuration.svelte';
import { EventRingBuffer } from '$lib/utils/ring-buffer';

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
	private buffer: any[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private msgID = 0;

	/**
	 * Add an event to the buffer and schedule a flush.
	 * Uses push() instead of unshift() for O(1) performance.
	 */
	addEvent(msg: any): void {
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

/**
 * Handle new gadget info (type 2).
 * Creates a new instance entry when a gadget starts.
 * Uses EventRingBuffer for O(1) event storage with automatic trimming.
 */
export function handleGadgetInfo(msg: any): void {
	const sessionInfo = msg.sessionInfo;

	instances[msg.instanceID] = {
		name: msg.data?.imageName || 'Unknown Gadget',
		running: true,
		gadgetInfo: msg.data,
		events: new EventRingBuffer(getMaxEvents()),
		logs: [],
		environment: msg.environmentID,
		startTime: Date.now(),
		eventCount: 0,
		session: sessionInfo
	};

	// Store session for single-session-per-start mode
	if (sessionInfo?.isNew && msg.environmentID) {
		currentSessionStore.set(msg.environmentID, sessionInfo.sessionId);
	}
}

/**
 * Handle individual gadget event (type 3).
 * Events are buffered and flushed every 25ms for performance.
 */
export function handleGadgetEvent(msg: any): void {
	eventBuffer.addEvent(msg);
}

/**
 * Handle gadget logging messages (type 4).
 * Appends log entries to the instance's log array.
 */
export function handleGadgetLogging(msg: any): void {
	if (instances[msg.instanceID]) {
		instances[msg.instanceID].logs.push(msg.data);
	}
}

/**
 * Handle gadget quit (type 5).
 * Marks the instance as no longer running.
 */
export function handleGadgetQuit(msg: any): void {
	if (instances[msg.instanceID]) {
		instances[msg.instanceID].running = false;
	}
}

/**
 * Handle bulk gadget event data (type 6).
 * Processes an array of events at once instead of individually.
 * Creates a new ring buffer and populates it with the provided events.
 */
export function handleGadgetArrayData(msg: any): void {
	if (!instances[msg.instanceID]) return;
	// Create new ring buffer and push all events
	const buffer = new EventRingBuffer<any>(getMaxEvents());
	const events = msg.data as any[];
	// Push in reverse order so newest ends up at index 0
	for (let i = events.length - 1; i >= 0; i--) {
		events[i].msgID = eventBuffer.getNextMsgID();
		buffer.push(events[i]);
	}
	instances[msg.instanceID].events = buffer;
	instances[msg.instanceID].eventCount += events.length;
}
