import type { ITransportAdapter, MessageHandler, ConnectionHandler } from './adapter';

/** Minimal structural type for the Wails v3 Events API. */
interface WailsEvents {
	On(event: string, cb: (msg: { data: string }) => void): void;
	Emit(event: string, data: string): void;
}

/**
 * Wails Events transport adapter for desktop app environments.
 * Uses the Wails v3 Events API for communication.
 */
export class WailsAdapter implements ITransportAdapter {
	private messageHandler: MessageHandler | null = null;
	private connectionHandler: ConnectionHandler | null = null;
	private _connected = false;
	private Events: WailsEvents | null = null;

	get connected(): boolean {
		return this._connected;
	}

	async connect(): Promise<void> {
		// Dynamic import to avoid loading Wails runtime in browser mode
		const runtime = await import('@wailsio/runtime');
		this.Events = runtime.Events;

		this._connected = true;
		this.connectionHandler?.(true);

		this.Events.On('client', (msg: { data: string }) => {
			if (this.messageHandler && msg.data) {
				this.messageHandler(msg.data);
			}
		});
	}

	send(message: string): void {
		this.Events?.Emit('server', message);
	}

	onMessage(handler: MessageHandler): void {
		this.messageHandler = handler;
	}

	onConnectionChange(handler: ConnectionHandler): void {
		this.connectionHandler = handler;
	}

	disconnect(): void {
		this._connected = false;
		this.connectionHandler?.(false);
	}
}
