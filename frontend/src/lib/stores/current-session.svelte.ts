/**
 * Tracks current recording session per environment for single-session-per-start mode.
 * This is an in-memory store that resets when the page is refreshed.
 */

// Map of environmentID -> sessionID
const currentSessions = $state<Record<string, string>>({});

export const currentSessionStore = {
	/**
	 * Get the current session ID for an environment
	 */
	get(environmentId: string): string | undefined {
		return currentSessions[environmentId];
	},

	/**
	 * Set the current session ID for an environment
	 */
	set(environmentId: string, sessionId: string): void {
		currentSessions[environmentId] = sessionId;
	},

	/**
	 * Clear the current session for an environment
	 */
	clear(environmentId: string): void {
		delete currentSessions[environmentId];
	},

	/**
	 * Clear all current sessions
	 */
	clearAll(): void {
		for (const key of Object.keys(currentSessions)) {
			delete currentSessions[key];
		}
	}
};
