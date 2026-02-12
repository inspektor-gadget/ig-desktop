import type { ITransportAdapter } from './adapter';

/**
 * WebSocket transport adapter for browser environments.
 * Connects to the backend via a standard WebSocket connection.
 */
export class WebSocketAdapter implements ITransportAdapter {
	private ws: WebSocket | null = null;
	private messageHandler: ((message: string) => void) | null = null;
	private connectionHandler: ((connected: boolean) => void) | null = null;
	private _connected = false;

	constructor(private url?: string) {}

	get connected(): boolean {
		return this._connected;
	}

	async connect(): Promise<void> {
		const wsUrl = this.url || `ws://${window.location.host}/api/v1/ws`;
		this.ws = new WebSocket(wsUrl);

		this.ws.addEventListener('error', () => {
			this._connected = false;
			this.connectionHandler?.(false);
		});

		this.ws.addEventListener('open', () => {
			this._connected = true;
			this.connectionHandler?.(true);
		});

		this.ws.addEventListener('close', () => {
			this._connected = false;
			this.connectionHandler?.(false);
		});

		this.ws.addEventListener('message', (ev) => {
			this.messageHandler?.(ev.data);
		});
	}

	send(message: string): void {
		this.ws?.send(message);
	}

	onMessage(handler: (message: string) => void): void {
		this.messageHandler = handler;
	}

	onConnectionChange(handler: (connected: boolean) => void): void {
		this.connectionHandler = handler;
	}

	disconnect(): void {
		this.ws?.close();
		this.ws = null;
		this._connected = false;
	}
}
