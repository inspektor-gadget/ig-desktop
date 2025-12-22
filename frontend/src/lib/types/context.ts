/**
 * Context types for Svelte context API.
 * These interfaces define the shape of objects passed via setContext/getContext.
 */

import type {
	SessionItem,
	SessionWithRuns,
	GadgetRun,
	RecordedEvent,
	GadgetInfo,
	GadgetDatasourceField
} from './index';

/**
 * API context provided by root layout for accessing backend services.
 * Use: const api = getContext<ApiContext>('api');
 */
export interface ApiContext {
	request(cmd: { cmd: string; data?: unknown }): Promise<unknown>;
	listSessions(environmentId: string): Promise<SessionItem[]>;
	deleteSession(sessionId: string): Promise<void>;
	getSession(sessionId: string): Promise<SessionWithRuns>;
	getRun(sessionId: string, runId: string): Promise<GadgetRun>;
	getRunEvents(sessionId: string, runId: string): Promise<RecordedEvent[]>;
}

/**
 * Inspect snapshot for viewing row details in the sidebar.
 */
export interface InspectSnapshot {
	fields: GadgetDatasourceField[];
	entry: Record<string, unknown>;
}

/**
 * Gadget context provided by Gadget component for child components.
 * Use: const gadget = getContext<GadgetContext>('gadget');
 */
export interface GadgetContext {
	info?: GadgetInfo;
	inspect?: InspectSnapshot;
}
