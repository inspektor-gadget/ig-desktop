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
	initializeIG,
	// i18n — plain i18next, usable from React without a React i18n binding.
	igI18n,
	t,
	setLanguage,
	getLanguage,
	onLanguageChange,
	supportedLanguages
} from '@inspektor-gadget/frontend';
