import type { ITransportAdapter } from './adapter';

/**
 * Electron IPC transport adapter stub.
 * For use with AKS Desktop (Headlamp fork) where the IG Desktop Go backend
 * communicates via Electron's IPC or a local WebSocket.
 */
export class ElectronIPCAdapter implements ITransportAdapter {
	private messageHandler: ((message: string) => void) | null = null;
	private connectionHandler: ((connected: boolean) => void) | null = null;
	private _connected = false;

	get connected(): boolean {
		return this._connected;
	}

	async connect(): Promise<void> {
		// TODO: Establish IPC channel or local WebSocket to Go backend
		throw new Error('ElectronIPCAdapter not yet implemented');
	}

	send(message: string): void {
		// TODO: Send message through Electron IPC
		throw new Error('ElectronIPCAdapter not yet implemented');
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
