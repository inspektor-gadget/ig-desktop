import type { ITransportAdapter, MessageHandler } from '$lib/transport/adapter';

/**
 * WebSocket service that manages connection lifecycle via pluggable transport adapters.
 * Supports Wails, browser WebSocket, demo, WASM, and Electron IPC backends.
 */
export class WebSocketService {
	private adapter: ITransportAdapter | null = null;
	connected = $state(false);
	isApp = $state(false);

	/**
	 * Initialize connection using a transport adapter.
	 *
	 * @param adapter - The transport adapter to use for communication
	 * @param messageHandler - Callback function to handle incoming messages
	 * @param isWailsApp - Whether running in Wails app (for legacy compatibility)
	 */
	initialize(adapter: ITransportAdapter, messageHandler: MessageHandler, isWailsApp = false): void {
		this.adapter = adapter;
		this.isApp = isWailsApp;

		adapter.onMessage(messageHandler);
		adapter.onConnectionChange((c) => {
			this.connected = c;
			if (c) {
				// Send handshake when connection is established
				this.send(JSON.stringify({ cmd: 'helo' }));
			}
		});

		adapter.connect();
	}

	/**
	 * Send a message through the transport adapter.
	 * @param message - The message to send (typically JSON stringified)
	 */
	send(message: string): void {
		if (this.adapter) {
			this.adapter.send(message);
		} else {
			console.error('Transport adapter not initialized');
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
