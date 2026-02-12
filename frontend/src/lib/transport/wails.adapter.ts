import type { ITransportAdapter } from './adapter';

/**
 * Wails Events transport adapter for desktop app environments.
 * Uses the Wails v3 Events API for communication.
 */
export class WailsAdapter implements ITransportAdapter {
	private messageHandler: ((message: string) => void) | null = null;
	private connectionHandler: ((connected: boolean) => void) | null = null;
	private _connected = false;
	private Events: any = null;

	get connected(): boolean {
		return this._connected;
	}

	async connect(): Promise<void> {
		// Dynamic import to avoid loading Wails runtime in browser mode
		const runtime = await import('@wailsio/runtime');
		this.Events = runtime.Events;

		this._connected = true;
		this.connectionHandler?.(true);

		console.log('installing client listener');
		this.Events.On('client', (msg: any) => {
			if (this.messageHandler && msg.data) {
				this.messageHandler(msg.data);
			}
		});
	}

	send(message: string): void {
		this.Events?.Emit('server', message);
	}

	onMessage(handler: (message: string) => void): void {
		this.messageHandler = handler;
	}

	onConnectionChange(handler: (connected: boolean) => void): void {
		this.connectionHandler = handler;
	}

	disconnect(): void {
		this._connected = false;
		this.connectionHandler?.(false);
	}
}
