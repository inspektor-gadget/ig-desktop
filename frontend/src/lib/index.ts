// IG Desktop Frontend Library
// This is the barrel export for use in non-SvelteKit host applications (React, etc.)

// --- Transport adapters ---
export type { ITransportAdapter } from './transport/adapter';
export { WebSocketAdapter } from './transport/websocket.adapter';
export { WailsAdapter } from './transport/wails.adapter';
export { DemoAdapter } from './transport/demo.adapter';
export { WasmAdapter } from './transport/wasm.adapter';
export { ElectronIPCAdapter } from './transport/electron-ipc.adapter';

// --- Services ---
export { WebSocketService, websocketService } from './services/websocket.service.svelte';
export { ApiService, apiService } from './services/api.service.svelte';
export { MessageRouterService, messageRouter } from './services/message-router.service.svelte';

// --- Shared state ---
export { environments } from './shared/environments.svelte';
export { instances } from './shared/instances.svelte';
export { deployments } from './shared/deployments.svelte';

// --- Types ---
export type {
	Environment,
	Environments,
	GadgetInstance,
	GadgetRunRequest,
	GadgetInfo,
	GadgetParam,
	GadgetDatasource,
	GadgetDatasourceField,
	GadgetInstanceData,
	Instances,
	SessionItem,
	SessionWithRuns,
	GadgetRun,
	RecordedEvent,
	LogEntry,
	DeploymentStatus,
	DeploymentConfig,
	DeploymentProgress,
	Deployments
} from './types';

// --- Key UI Components ---
export { default as Gadget } from './components/Gadget.svelte';
export { default as GadgetSettings } from './components/GadgetSettings.svelte';
export { default as VirtualTable } from './components/VirtualTable/VirtualTable.svelte';
export { default as Button } from './components/Button.svelte';
export { default as BaseModal } from './components/BaseModal.svelte';
export { default as Panel } from './components/Panel.svelte';
export { default as Spinner } from './components/Spinner.svelte';
export { default as Tab } from './components/Tab.svelte';
export { default as NavbarLink } from './components/NavbarLink.svelte';

// --- Initialization for non-SvelteKit hosts ---
export { setBasePath } from './compat/app-paths';
export { setPage } from './compat/app-state';
export { setNavigationHandler } from './compat/app-navigation';

// --- Convenience initializer ---
import type { ITransportAdapter } from './transport/adapter';
import { setBasePath } from './compat/app-paths';
import { setNavigationHandler } from './compat/app-navigation';
import { websocketService } from './services/websocket.service.svelte';
import { messageRouter } from './services/message-router.service.svelte';

/**
 * Initialize the IG frontend library for use in a non-SvelteKit host.
 * Call this before mounting any Svelte components.
 */
export function initializeIG(options: {
	adapter: ITransportAdapter;
	basePath?: string;
	onNavigate?: (url: string) => void;
}): void {
	if (options.basePath) setBasePath(options.basePath);
	if (options.onNavigate) setNavigationHandler(options.onNavigate);
	websocketService.initialize(options.adapter, (message) => messageRouter.route(message));
}
