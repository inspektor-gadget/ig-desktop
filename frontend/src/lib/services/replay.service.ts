import {
	handleGadgetEvent,
	handleGadgetLogging,
	handleGadgetArrayData
} from '$lib/handlers/gadget.handler';
import type { RecordedEvent } from '$lib/types';

// Event type constants (from internal/api/constants.go)
const TypeGadgetEvent = 3;
const TypeGadgetLog = 4;
const TypeGadgetEventArray = 6;

export interface ReplayOptions {
	instanceId: string;
	events: RecordedEvent[];
	mode: 'instant' | 'realtime';
	onComplete?: () => void;
	onProgress?: (current: number, total: number) => void;
}

export class ReplayService {
	private abortController: AbortController | null = null;

	async play(options: ReplayOptions): Promise<void> {
		this.abortController = new AbortController();
		const { instanceId, events, mode, onComplete, onProgress } = options;

		if (mode === 'instant') {
			await this.playInstant(instanceId, events, onProgress);
		} else {
			await this.playRealtime(instanceId, events, this.abortController.signal, onProgress);
		}

		onComplete?.();
	}

	stop(): void {
		this.abortController?.abort();
	}

	private async playInstant(
		instanceId: string,
		events: RecordedEvent[],
		onProgress?: (current: number, total: number) => void
	): Promise<void> {
		// Emit all events immediately through handlers
		for (let i = 0; i < events.length; i++) {
			this.emitEvent(instanceId, events[i]);
			onProgress?.(i + 1, events.length);
		}
	}

	private async playRealtime(
		instanceId: string,
		events: RecordedEvent[],
		signal: AbortSignal,
		onProgress?: (current: number, total: number) => void
	): Promise<void> {
		if (events.length === 0) return;

		const baseTime = events[0].timestamp;
		const startTime = Date.now();

		for (let i = 0; i < events.length; i++) {
			if (signal.aborted) return;

			const event = events[i];
			const eventOffset = event.timestamp - baseTime;
			const elapsedTime = Date.now() - startTime;
			const delay = eventOffset - elapsedTime;

			if (delay > 0) {
				await this.sleep(delay, signal);
				if (signal.aborted) return;
			}

			this.emitEvent(instanceId, event);
			onProgress?.(i + 1, events.length);
		}
	}

	private sleep(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve) => {
			const timeout = setTimeout(resolve, ms);
			signal.addEventListener('abort', () => {
				clearTimeout(timeout);
				resolve(); // Resolve instead of reject for clean abort
			});
		});
	}

	private emitEvent(instanceId: string, event: RecordedEvent): void {
		// Ensure event data has the structure expected by handlers
		// The msgID will be assigned by EventBuffer for individual events
		// or by handleGadgetArrayData for array events
		const payload = {
			instanceID: instanceId,
			type: event.type,
			datasourceID: event.datasourceId,
			data: event.data
		};

		switch (event.type) {
			case TypeGadgetEvent:
				handleGadgetEvent(payload);
				break;
			case TypeGadgetLog:
				handleGadgetLogging(payload);
				break;
			case TypeGadgetEventArray:
				handleGadgetArrayData(payload);
				break;
		}
	}
}
