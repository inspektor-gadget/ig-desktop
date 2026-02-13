import type { ITransportAdapter, MessageHandler, ConnectionHandler } from './adapter';

/**
 * WASM transport adapter stub.
 * Will wrap the IG gRPC WASM client for browser-based communication
 * through the Kubernetes API Server via WebSockets.
 */
export class WasmAdapter implements ITransportAdapter {
	private messageHandler: MessageHandler | null = null;
	private connectionHandler: ConnectionHandler | null = null;
	private _connected = false;

	get connected(): boolean {
		return this._connected;
	}

	async connect(): Promise<void> {
		// TODO: Initialize WASM module and establish connection
		// through Kubernetes API Server WebSockets
		throw new Error('WasmAdapter not yet implemented');
	}

	send(message: string): void {
		// TODO: Send message through WASM gRPC client
		throw new Error('WasmAdapter not yet implemented');
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
