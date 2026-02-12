import type { ITransportAdapter } from './adapter';
import { demoBackend } from '../services/demo-backend.service.svelte';

/**
 * Demo transport adapter that uses the DemoBackendService
 * to serve static pre-recorded session data.
 */
export class DemoAdapter implements ITransportAdapter {
	private messageHandler: ((message: string) => void) | null = null;
	private connectionHandler: ((connected: boolean) => void) | null = null;
	private _connected = false;

	get connected(): boolean {
		return this._connected;
	}

	async connect(): Promise<void> {
		console.log('Initializing demo mode backend');

		// Wire up the demo backend to route messages through us
		demoBackend.setMessageHandler((message: string) => {
			this.messageHandler?.(message);
		});

		// Initialize demo backend (loads config and sessions) before signaling connected
		await demoBackend.initialize();

		this._connected = true;
		this.connectionHandler?.(true);
	}

	send(message: string): void {
		demoBackend.handleCommand(message);
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
