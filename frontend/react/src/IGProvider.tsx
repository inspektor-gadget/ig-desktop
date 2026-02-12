import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { initializeIG, type ITransportAdapter } from '@inspektor-gadget/frontend';

interface IGContextValue {
	adapter: ITransportAdapter;
}

const IGContext = createContext<IGContextValue | null>(null);

interface IGProviderProps {
	/** Transport adapter for backend communication */
	adapter: ITransportAdapter;
	/** Base path for asset loading (e.g., '/ig' for subpath deployments) */
	basePath?: string;
	/** Navigation handler called when IG components want to navigate */
	onNavigate?: (url: string) => void;
	children: ReactNode;
}

/**
 * React context provider that initializes the IG frontend library.
 * Wrap your app (or the section using IG components) with this provider.
 *
 * Usage:
 * ```tsx
 * <IGProvider adapter={new WebSocketAdapter('ws://localhost:8087/api/v1/ws')}>
 *   <SvelteWrapper component={Gadget} instanceID="abc" />
 * </IGProvider>
 * ```
 */
export function IGProvider({ adapter, basePath, onNavigate, children }: IGProviderProps) {
	useEffect(() => {
		initializeIG({ adapter, basePath, onNavigate });
		return () => adapter.disconnect();
	}, [adapter, basePath, onNavigate]);

	return <IGContext.Provider value={{ adapter }}>{children}</IGContext.Provider>;
}

/**
 * Hook to access the IG context (adapter) from within a React component.
 */
export function useIG(): IGContextValue {
	const context = useContext(IGContext);
	if (!context) {
		throw new Error('useIG must be used within an IGProvider');
	}
	return context;
}
