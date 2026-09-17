/** Host commands are applied when the prop changes; manual controls remain usable. */
export interface ResultViewState {
	search?: string;
	/** Datasource name to registered visualizer ID (for example, `table`). */
	visualizers?: Record<string, string>;
}

export interface ResultViewChange {
	instanceID: string;
	search: string;
	visualizers: Record<string, string>;
	availableVisualizers: Record<string, string[]>;
}

export interface EmbeddableAppState {
	path: string;
	/** Absent until a result screen and its datasource views have mounted. */
	result?: ResultViewChange;
}

/** A reviewed launcher prefill. Hosts must not use this to execute a gadget. */
export interface GadgetLaunchPreset {
	image: string;
	environmentID?: string;
	params?: Record<string, string>;
	detached?: boolean;
	instanceName?: string;
	record?: boolean;
	sessionId?: string;
	sessionName?: string;
}

export interface EmbeddableAppProps {
	/** Desktop route, including query parameters. Defaults to `/`. */
	path?: string;
	onNavigate?: (path: string) => void;
	viewState?: ResultViewState;
	/** Effective state, including manual edits and unsupported-visualizer fallback. */
	onStateChange?: (state: EmbeddableAppState) => void;
	/** Expose the existing experimental recording/session UI in this application. */
	sessions?: boolean;
	/** Suppress the built-in renderer when the embedding host renders native toasts. */
	showToasts?: boolean;
	/** Show application navigation when the host does not provide its own. */
	showNavigation?: boolean;
	/** Show the internal environment/result tab strip. */
	showTabs?: boolean;
	/** Prefill the launcher shown by a matching launch route; it never auto-runs. */
	launchPreset?: GadgetLaunchPreset;
}
