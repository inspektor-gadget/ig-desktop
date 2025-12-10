import { APP_MODE } from '$lib/config/app-mode';
import { demoBackend } from './demo-backend.service.svelte';

type WebSocketLike = {
	send: (data: string) => void;
};

type MessageHandler = (message: string) => void;

/**
 * WebSocket service that manages connection lifecycle for Wails, browser, and demo environments.
 */
export class WebSocketService {
	private ws: WebSocketLike | null = $state(null);
	private messageHandler: MessageHandler | null = null;
	connected = $state(false);
	isApp = $state(false);

	/**
	 * Initialize WebSocket connection.
	 * Supports three modes:
	 * - Wails (desktop app using Events API)
	 * - Browser (WebSocket to backend server)
	 * - Demo (static data from pre-recorded sessions)
	 *
	 * @param isWailsApp - Whether running in Wails app (true) or browser (false)
	 * @param messageHandler - Callback function to handle incoming messages
	 */
	initialize(isWailsApp: boolean, messageHandler: MessageHandler): void {
		this.isApp = isWailsApp;
		this.messageHandler = messageHandler;

		if (APP_MODE === 'demo') {
			this.initializeDemo();
		} else if (isWailsApp) {
			this.initializeWails();
		} else {
			this.initializeBrowser();
		}
	}

	/**
	 * Initialize for demo mode - uses static JSON data from pre-recorded sessions.
	 */
	private async initializeDemo(): Promise<void> {
		console.log('Initializing demo mode backend');

		// Set up the demo backend to route messages back to us
		demoBackend.setMessageHandler((message: string) => {
			if (this.messageHandler) {
				this.messageHandler(message);
			}
		});

		this.connected = true;
		this.ws = {
			send: (msg: string) => {
				demoBackend.handleCommand(msg);
			}
		};

		// Initialize demo backend (loads config and sessions)
		await demoBackend.initialize();

		// Send handshake
		this.send(JSON.stringify({ cmd: 'helo' }));
	}

	/**
	 * Initialize WebSocket for Wails environment using Events API.
	 */
	private async initializeWails(): Promise<void> {
		// Dynamic import to avoid loading Wails runtime in browser mode
		const { Events } = await import('@wailsio/runtime');

		this.connected = true;
		this.ws = {
			send: (msg: string) => {
				Events.Emit('server', msg);
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
			// Send handshake to trigger backend to load environments
			this.send(JSON.stringify({ cmd: 'helo' }));
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
