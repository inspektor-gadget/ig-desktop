import { instances } from '$lib/shared/instances.svelte';

/**
 * Buffer for gadget events to improve performance by batching updates.
 */
class EventBuffer {
	private buffer: any[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private msgID = 0;

	/**
	 * Add an event to the buffer and schedule a flush.
	 */
	addEvent(msg: any): void {
		this.buffer.unshift(msg);
		if (!this.timer) {
			this.timer = setTimeout(() => {
				this.flush();
			}, 25);
		}
	}

	/**
	 * Flush all buffered events to their respective instances.
	 */
	private flush(): void {
		this.timer = null;
		const usedInstances: Record<string, boolean> = {};

		this.buffer.forEach((msg) => {
			if (!instances[msg.instanceID] || !instances[msg.instanceID].events) {
				console.log('not existing');
				return;
			}
			instances[msg.instanceID].events.unshift(msg.data);
			instances[msg.instanceID].eventCount++;
			usedInstances[msg.instanceID] = true;
		});

		// Trim events to max 100 per instance
		Object.keys(usedInstances).forEach((instanceID) => {
			if (instances[instanceID].events.length > 100) {
				instances[instanceID].events = instances[instanceID].events.slice(0, 100);
			}
		});

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
 */
export function handleGadgetInfo(msg: any): void {
	console.log('new gadget', msg);
	instances[msg.instanceID] = {
		name: msg.data?.imageName || 'Unknown Gadget',
		running: true,
		gadgetInfo: msg.data,
		events: [],
		logs: [],
		environment: msg.environmentID,
		startTime: Date.now(),
		eventCount: 0
	};
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
 */
export function handleGadgetArrayData(msg: any): void {
	console.log('arrayData', msg.data);
	if (instances[msg.instanceID]) {
		instances[msg.instanceID].events = msg.data.map((evt: any) => {
			evt.msgID = eventBuffer.getNextMsgID();
			return evt;
		});
		instances[msg.instanceID].eventCount += msg.data.length;
	}
}
