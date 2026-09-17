import type { ITransportAdapter, MessageHandler } from '$lib/transport/adapter';

/**
 * WebSocket service that manages connection lifecycle via pluggable transport adapters.
 * Supports Wails, browser WebSocket, demo, WASM, and Electron IPC backends.
 */
export class WebSocketService {
	private adapter: ITransportAdapter | null = null;
	private onDisconnect: (reason: unknown) => void = () => {};
	connected = $state(false);
	isApp = $state(false);

	/**
	 * Initialize connection using a transport adapter.
	 *
	 * @param adapter - The transport adapter to use for communication
	 * @param messageHandler - Callback function to handle incoming messages
	 * @param isWailsApp - Whether running in Wails app (for legacy compatibility)
	 */
	initialize(
		adapter: ITransportAdapter,
		messageHandler: MessageHandler,
		isWailsApp = false,
		onDisconnect: (reason: unknown) => void = () => {}
	): void {
		this.disconnect();
		this.adapter = adapter;
		this.onDisconnect = onDisconnect;
		this.isApp = isWailsApp;

		adapter.onMessage((message) => {
			if (this.adapter === adapter) messageHandler(message);
		});
		adapter.onConnectionChange((c) => {
			if (this.adapter !== adapter) return;
			this.connected = c;
			if (c) {
				// Send handshake when connection is established
				this.send(JSON.stringify({ cmd: 'helo' }));
			} else {
				this.onDisconnect(new Error('IG transport disconnected'));
			}
		});

		void adapter.connect().catch((error) => {
			if (this.adapter !== adapter) return;
			this.connected = false;
			this.onDisconnect(error);
		});
	}

	/** Disconnect the current transport and reject its outstanding API calls. */
	disconnect(expectedAdapter?: ITransportAdapter): void {
		if (expectedAdapter && this.adapter !== expectedAdapter) return;
		const adapter = this.adapter;
		this.adapter = null;
		this.connected = false;
		this.onDisconnect(new Error('IG transport disconnected'));
		adapter?.disconnect();
	}

	/**
	 * Send a message through the transport adapter.
	 * @param message - The message to send (typically JSON stringified)
	 */
	send(message: string): void {
		if (this.adapter) {
			this.adapter.send(message);
		} else {
			throw new Error('Transport adapter not initialized');
		}
	}

	/**
	 * Get a WebSocket-like send interface (for legacy compatibility).
	 */
	getWebSocket(): { send: (data: string) => void } | null {
		if (this.adapter) {
			return { send: (msg: string) => this.adapter!.send(msg) };
		}
		return null;
	}
}

/**
 * Singleton instance of WebSocketService.
 */
export const websocketService = new WebSocketService();
