/** Callback invoked with each incoming message string. */
export type MessageHandler = (message: string) => void;

/** Callback invoked when the connection state changes. */
export type ConnectionHandler = (connected: boolean) => void;

/**
 * Transport adapter interface for abstracting the communication layer.
 * Implementations connect to different backends (WebSocket, Wails, WASM, etc.)
 */
export interface ITransportAdapter {
	/** Establish connection to the backend */
	connect(): Promise<void>;

	/** Send a message string to the backend */
	send(message: string): void;

	/** Register a handler for incoming messages */
	onMessage(handler: MessageHandler): void;

	/** Register a handler for connection state changes */
	onConnectionChange(handler: ConnectionHandler): void;

	/** Disconnect from the backend */
	disconnect(): void;

	/** Whether the adapter is currently connected */
	readonly connected: boolean;
}
