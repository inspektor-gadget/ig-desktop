import { websocketService } from './websocket.service.svelte';
import type { SessionItem, SessionWithRuns, GadgetRun, RecordedEvent } from '$lib/types';
import type { PluginManifest } from '$lib/types/plugin-manifest';

export interface DiscoveredPlugin {
	manifest: PluginManifest;
	path: string;
	files: Record<string, string>;
}

export interface ListPluginsResponse {
	plugins: DiscoveredPlugin[];
	pluginsDir: string;
}

/** Response to the `checkForUpdates` command. */
export interface CheckForUpdatesResponse {
	currentVersion?: string;
	latestVersion?: string;
	igLibraryVersion?: string;
	updateAvailable?: boolean;
	releasesUrl?: string;
	error?: string;
}

/** Response to the `getVersion` command. */
export interface GetVersionResponse {
	version?: string;
}

export type RequestCommand = {
	cmd: string;
	reqID?: string;
	[key: string]: unknown;
};

/** A parsed response message (type 1) from the server. */
type ResponseMessage = {
	reqID?: string;
	success?: boolean;
	error?: unknown;
	data?: unknown;
};

type PendingRequest = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type-erased registry: each pending request resolves to a different shape
	resolve: (data: any) => void;
	reject: (error: unknown) => void;
};

/**
 * API service that provides a promise-based request/response pattern over WebSocket.
 */
export class ApiService {
	private reqID = 0;
	private requests: Record<string, PendingRequest> = {};

	/**
	 * Send a request command and get a promise that resolves with the response.
	 * @param cmd - The command object to send
	 * @returns Promise that resolves with the response data
	 */
	request<T = unknown>(cmd: RequestCommand): Promise<T> {
		this.reqID++;
		cmd.reqID = '' + this.reqID; // stringify

		const prom = new Promise<T>((resolve, reject) => {
			this.requests[cmd.reqID!] = { resolve, reject };
		});

		websocketService.send(JSON.stringify(cmd));
		return prom;
	}

	/**
	 * Handle a response message (type 1) from the server.
	 * @param msg - The parsed message object
	 */
	handleResponse(msg: ResponseMessage): void {
		if (msg.reqID && this.requests[msg.reqID]) {
			if (!msg.success) {
				this.requests[msg.reqID].reject(msg.error);
				delete this.requests[msg.reqID];
				return;
			}
			this.requests[msg.reqID].resolve(msg.data);
			delete this.requests[msg.reqID];
		}
	}

	/**
	 * List all sessions for a given environment.
	 * @param environmentId - The environment ID
	 * @returns Promise that resolves with an array of session items
	 */
	async listSessions(environmentId: string): Promise<SessionItem[]> {
		return this.request({ cmd: 'listSessions', data: { environmentId } });
	}

	/**
	 * Delete a session by ID.
	 * @param sessionId - The session ID to delete
	 * @returns Promise that resolves when the session is deleted
	 */
	async deleteSession(sessionId: string): Promise<void> {
		await this.request({ cmd: 'deleteSession', data: { sessionId } });
	}

	/**
	 * Get a session with all its gadget runs.
	 * @param sessionId - The session ID
	 * @returns Promise that resolves with the session and its runs
	 */
	async getSession(sessionId: string): Promise<SessionWithRuns> {
		return this.request({ cmd: 'getSession', data: { sessionId } });
	}

	/**
	 * Get a specific gadget run from a session.
	 * @param sessionId - The session ID
	 * @param runId - The run ID
	 * @returns Promise that resolves with the gadget run
	 */
	async getRun(sessionId: string, runId: string): Promise<GadgetRun> {
		return this.request({ cmd: 'getRun', data: { sessionId, runId } });
	}

	/**
	 * Get all events for a specific gadget run.
	 * @param sessionId - The session ID
	 * @param runId - The run ID
	 * @returns Promise that resolves with an array of recorded events
	 */
	async getRunEvents(sessionId: string, runId: string): Promise<RecordedEvent[]> {
		return this.request({ cmd: 'getRunEvents', data: { sessionId, runId } });
	}

	/**
	 * List all discovered local plugins.
	 * @returns Promise that resolves with the list of plugins and plugins directory
	 */
	async listPlugins(): Promise<ListPluginsResponse> {
		return this.request({ cmd: 'listPlugins' });
	}

	/**
	 * Get a specific plugin by ID with its source files.
	 * @param id - The plugin ID
	 * @returns Promise that resolves with the plugin
	 */
	async getPlugin(id: string): Promise<DiscoveredPlugin> {
		return this.request({ cmd: 'getPlugin', data: { id } });
	}
}

/**
 * Singleton instance of ApiService.
 */
export const apiService = new ApiService();
