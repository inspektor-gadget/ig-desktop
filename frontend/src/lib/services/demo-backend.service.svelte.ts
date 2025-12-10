// Copyright 2025 The Inspektor Gadget authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type {
	Environment,
	SessionItem,
	SessionWithRuns,
	GadgetRun,
	RecordedEvent,
	GadgetInfo
} from '$lib/types';

/**
 * Demo session data structure - loaded from JSON files
 */
export interface DemoSession {
	session: SessionWithRuns;
	events: Record<string, RecordedEvent[]>; // runId -> events
}

/**
 * Demo mode configuration - loaded from /demo/config.json
 */
export interface DemoConfig {
	environment: Environment;
	/** Paths to session JSON files relative to /demo/sessions/ */
	sessions: string[];
}

type MessageHandler = (message: string) => void;

/**
 * Demo backend service that simulates the backend using pre-recorded session data.
 * Implements a similar interface to the real backend but serves static data.
 */
export class DemoBackendService {
	private config: DemoConfig | null = null;
	private sessions: Map<string, DemoSession> = new Map();
	private messageHandler: MessageHandler | null = null;

	/**
	 * Set the message handler for sending messages back to the frontend.
	 */
	setMessageHandler(handler: MessageHandler): void {
		this.messageHandler = handler;
	}

	/**
	 * Initialize demo mode - load config and session metadata.
	 */
	async initialize(): Promise<void> {
		try {
			// Load demo config
			const configResponse = await fetch('/demo/config.json');
			if (!configResponse.ok) {
				console.error('Failed to load demo config:', configResponse.status);
				return;
			}
			this.config = await configResponse.json();

			// Send environment to frontend (type 100 = TypeEnvironmentCreate)
			this.sendMessage({
				type: 100,
				data: this.config.environment
			});

			// Load all session files
			for (const sessionPath of this.config.sessions) {
				try {
					const response = await fetch(`/demo/sessions/${sessionPath}`);
					if (!response.ok) {
						console.error(`Failed to load session ${sessionPath}:`, response.status);
						continue;
					}
					const sessionData: DemoSession = await response.json();
					this.sessions.set(sessionData.session.id, sessionData);
				} catch (err) {
					console.error(`Error loading session ${sessionPath}:`, err);
				}
			}

			console.log(`Demo backend initialized with ${this.sessions.size} sessions`);
		} catch (err) {
			console.error('Error initializing demo backend:', err);
		}
	}

	/**
	 * Handle incoming commands from the frontend.
	 */
	handleCommand(message: string): void {
		try {
			const msg = JSON.parse(message);

			switch (msg.cmd) {
				case 'helo':
					// Initial handshake - environment already sent in initialize()
					// Send version info
					if (msg.reqID) {
						this.sendResponse(msg.reqID, true, { version: 'demo' });
					}
					break;

				case 'getVersion':
					this.sendResponse(msg.reqID, true, { version: 'demo' });
					break;

				case 'listSessions':
					this.handleListSessions(msg);
					break;

				case 'getSession':
					this.handleGetSession(msg);
					break;

				case 'getRun':
					this.handleGetRun(msg);
					break;

				case 'getRunEvents':
					this.handleGetRunEvents(msg);
					break;

				case 'replaySession':
					this.handleReplaySession(msg);
					break;

				case 'listInstances':
					// Return empty list - no running instances in demo mode
					this.sendResponse(msg.reqID, true, { gadgetInstances: [] });
					break;

				default:
					// Return error for unsupported commands
					this.sendResponse(msg.reqID, false, null, 'Operation not supported in demo mode');
			}
		} catch (err) {
			console.error('Error handling demo command:', err);
		}
	}

	private handleListSessions(msg: { reqID: string; data?: { environmentId: string } }): void {
		const sessions: SessionItem[] = [];
		for (const [, data] of this.sessions) {
			sessions.push({
				id: data.session.id,
				name: data.session.name,
				environmentId: data.session.environmentId,
				createdAt: data.session.createdAt,
				updatedAt: data.session.updatedAt,
				runCount: data.session.runCount
			});
		}
		this.sendResponse(msg.reqID, true, sessions);
	}

	private handleGetSession(msg: { reqID: string; data?: { sessionId: string } }): void {
		const sessionId = msg.data?.sessionId;
		if (!sessionId) {
			this.sendResponse(msg.reqID, false, null, 'Session ID required');
			return;
		}

		const session = this.sessions.get(sessionId);
		if (!session) {
			this.sendResponse(msg.reqID, false, null, 'Session not found');
			return;
		}
		this.sendResponse(msg.reqID, true, session.session);
	}

	private handleGetRun(msg: { reqID: string; data?: { sessionId: string; runId: string } }): void {
		const { sessionId, runId } = msg.data || {};
		if (!sessionId || !runId) {
			this.sendResponse(msg.reqID, false, null, 'Session ID and Run ID required');
			return;
		}

		const session = this.sessions.get(sessionId);
		if (!session) {
			this.sendResponse(msg.reqID, false, null, 'Session not found');
			return;
		}

		const run = session.session.runs.find((r) => r.id === runId);
		if (!run) {
			this.sendResponse(msg.reqID, false, null, 'Run not found');
			return;
		}
		this.sendResponse(msg.reqID, true, run);
	}

	private handleGetRunEvents(msg: {
		reqID: string;
		data?: { sessionId: string; runId: string };
	}): void {
		const { sessionId, runId } = msg.data || {};
		if (!sessionId || !runId) {
			this.sendResponse(msg.reqID, false, null, 'Session ID and Run ID required');
			return;
		}

		const session = this.sessions.get(sessionId);
		if (!session) {
			this.sendResponse(msg.reqID, false, null, 'Session not found');
			return;
		}

		const events = session.events[runId] || [];
		this.sendResponse(msg.reqID, true, events);
	}

	private async handleReplaySession(msg: {
		reqID: string;
		data?: { sessionId: string; runId: string; mode?: 'instant' | 'realtime' };
	}): Promise<void> {
		const { sessionId, runId, mode = 'instant' } = msg.data || {};
		if (!sessionId || !runId) {
			this.sendResponse(msg.reqID, false, null, 'Session ID and Run ID required');
			return;
		}

		const session = this.sessions.get(sessionId);
		if (!session) {
			this.sendResponse(msg.reqID, false, null, 'Session not found');
			return;
		}

		const run = session.session.runs.find((r) => r.id === runId);
		if (!run) {
			this.sendResponse(msg.reqID, false, null, 'Run not found');
			return;
		}

		const events = session.events[runId] || [];

		// Generate a unique instance ID for this replay
		const instanceID = `replay-${Date.now()}`;

		// Send gadget info (type 2)
		this.sendMessage({
			type: 2,
			instanceID,
			environmentID: this.config?.environment.id,
			data: run.gadgetInfo,
			instanceName: run.gadgetImage
		});

		// Return success with instance ID
		this.sendResponse(msg.reqID, true, { id: instanceID });

		// Replay events
		if (mode === 'realtime') {
			await this.replayEventsRealtime(instanceID, events);
		} else {
			this.replayEventsInstant(instanceID, events);
		}

		// Send quit (type 5)
		this.sendMessage({
			type: 5,
			instanceID
		});
	}

	/**
	 * Replay events instantly (all at once)
	 */
	private replayEventsInstant(instanceID: string, events: RecordedEvent[]): void {
		for (const event of events) {
			this.sendMessage({
				type: event.type,
				instanceID,
				datasourceID: event.datasourceId,
				data: event.data
			});
		}
	}

	/**
	 * Replay events with timing (scaled down for demo)
	 */
	private async replayEventsRealtime(instanceID: string, events: RecordedEvent[]): Promise<void> {
		if (events.length === 0) return;

		let lastTimestamp = events[0].timestamp;

		for (const event of events) {
			// Add delays based on original timing (scaled down by 10x for demo, max 100ms)
			const delay = Math.min((event.timestamp - lastTimestamp) / 10, 100);
			if (delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
			lastTimestamp = event.timestamp;

			// Send event based on type
			this.sendMessage({
				type: event.type,
				instanceID,
				datasourceID: event.datasourceId,
				data: event.data
			});
		}
	}

	private sendResponse(reqID: string, success: boolean, data: unknown, error?: string): void {
		this.sendMessage({
			type: 1, // TypeCommandResponse
			reqID,
			success,
			data,
			error
		});
	}

	private sendMessage(msg: unknown): void {
		if (this.messageHandler) {
			this.messageHandler(JSON.stringify(msg));
		}
	}
}

/**
 * Singleton instance of DemoBackendService.
 */
export const demoBackend = new DemoBackendService();
