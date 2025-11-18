import { Events } from '@wailsio/runtime';

type WebSocketLike = {
	send: (data: string) => void;
};

type MessageHandler = (message: string) => void;

/**
 * WebSocket service that manages connection lifecycle for both Wails and browser environments.
 */
export class WebSocketService {
	private ws: WebSocketLike | null = $state(null);
	private messageHandler: MessageHandler | null = null;
	connected = $state(false);
	isApp = $state(false);

	/**
	 * Initialize WebSocket connection.
	 * @param isWailsApp - Whether running in Wails app (true) or browser (false)
	 * @param messageHandler - Callback function to handle incoming messages
	 */
	initialize(isWailsApp: boolean, messageHandler: MessageHandler): void {
		this.isApp = isWailsApp;
		this.messageHandler = messageHandler;

		if (isWailsApp) {
			this.initializeWails();
		} else {
			this.initializeBrowser();
		}
	}

	/**
	 * Initialize WebSocket for Wails environment using Events API.
	 */
	private initializeWails(): void {
		this.connected = true;
		this.ws = {
			send: (msg: string) => {
				Events.Emit({ name: 'server', data: msg });
			}
		};

		console.log('installing client listener');
		Events.On('client', (msg) => {
			if (this.messageHandler && msg.data) {
				this.messageHandler(msg.data);
			}
		});

		// Handshake with Wails
		this.send(JSON.stringify({ cmd: 'helo' }));
	}

	/**
	 * Initialize WebSocket for browser environment.
	 */
	private initializeBrowser(): void {
		const ws = new WebSocket(`ws://${window.location.host}/api/v1/ws`);
		this.ws = ws;

		ws.addEventListener('error', () => {
			this.connected = false;
		});

		ws.addEventListener('open', () => {
			this.connected = true;
		});

		ws.addEventListener('close', () => {
			this.connected = false;
		});

		ws.addEventListener('message', (ev) => {
			if (this.messageHandler) {
				this.messageHandler(ev.data);
			}
		});
	}

	/**
	 * Send a message through the WebSocket connection.
	 * @param message - The message to send (typically JSON stringified)
	 */
	send(message: string): void {
		if (this.ws) {
			this.ws.send(message);
		} else {
			console.error('WebSocket not initialized');
		}
	}

	/**
	 * Get the raw WebSocket instance (for compatibility with existing code).
	 */
	getWebSocket(): WebSocketLike | null {
		return this.ws;
	}
}

/**
 * Singleton instance of WebSocketService.
 */
export const websocketService = new WebSocketService();
