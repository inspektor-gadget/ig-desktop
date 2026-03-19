export { SvelteWrapper } from './SvelteWrapper';
export { IGProvider, useIG } from './IGProvider';

// Re-export key types and utilities from the main package for convenience
export type { ITransportAdapter } from '@inspektor-gadget/frontend';
export {
	WebSocketAdapter,
	WailsAdapter,
	DemoAdapter,
	WasmAdapter,
	ElectronIPCAdapter,
	initializeIG
} from '@inspektor-gadget/frontend';
