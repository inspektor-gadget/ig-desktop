// IG Desktop Frontend Library
// This is the barrel export for use in non-SvelteKit host applications (React, etc.)

// Tailwind v4 utility classes + IG design tokens.
// Without this import, the library build produces zero Tailwind CSS
// because the app's app.css (which has @import 'tailwindcss') is
// only part of the SvelteKit app, not the library entry graph.
import './lib.css';

// --- Transport adapters ---
export type { ITransportAdapter, MessageHandler, ConnectionHandler } from './transport/adapter';
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

// --- ViewConfig ---
export type { ViewConfig } from './types/view-config';
export { resolveViewConfig } from './types/view-config';

// --- Cell interaction ---
export type {
	CellInteractionEvent,
	CellClickHandler,
	CellContextMenuHandler
} from './types/cell-interaction';

// --- Annotation providers ---
export type {
	FieldAnnotationProvider,
	DatasourceAnnotationProvider,
	AnnotationProviders
} from './services/annotation-provider.service';
export {
	registerAnnotationProvider,
	applyFieldAnnotationProviders,
	applyDatasourceAnnotationProviders
} from './services/annotation-provider.service';

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
export { default as DeployModalWrapper } from './components/wrappers/DeployModalWrapper.svelte';
export { default as GadgetWrapper } from './components/wrappers/GadgetWrapper.svelte';

// --- Theming ---
export { setTheme, resetTheme } from './themes/set-theme';
export type { IGThemeTokens } from './themes/set-theme';
export { materialLight, materialDark } from './themes/material-tokens';
export { headlampLight, headlampDark } from './themes/headlamp-tokens';

// --- Initialization for non-SvelteKit hosts ---
export { setBasePath } from './compat/app-paths';
export { setPage } from './compat/app-state';
export { setNavigationHandler } from './compat/app-navigation';
export { registerBuiltinPlugins } from './plugins/builtin';

// --- Convenience initializer ---
import type { ITransportAdapter } from './transport/adapter';
import { setBasePath } from './compat/app-paths';
import { setNavigationHandler } from './compat/app-navigation';
import { websocketService } from './services/websocket.service.svelte';
import { messageRouter } from './services/message-router.service.svelte';
import { registerBuiltinPlugins } from './plugins/builtin';

/**
 * Initialize the IG frontend library for use in a non-SvelteKit host.
 * Call this before mounting any Svelte components.
 */
export function initializeIG(options: {
	adapter: ITransportAdapter;
	basePath?: string;
	onNavigate?: (url: string) => void;
}): void {
	registerBuiltinPlugins();
	if (options.basePath) setBasePath(options.basePath);
	if (options.onNavigate) setNavigationHandler(options.onNavigate);
	websocketService.initialize(options.adapter, (message) => messageRouter.route(message));
}
