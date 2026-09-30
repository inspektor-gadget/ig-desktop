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
	/** Applies only to the launch route for this image (compared as the route decodes it). */
	image: string;
	/** An ephemeral host target: fixed environment, foreground only, no history/recording. */
	transient?: boolean;
	/** Locks the selection; the host must route this launcher's requests through its frozen handle. */
	kubernetesTargetID?: string;
	kubernetesTargetName?: string;
	environmentID?: string;
	params?: Record<string, string>;
	detached?: boolean;
	instanceName?: string;
	record?: boolean;
	sessionId?: string;
	sessionName?: string;
	output?: {
		format: 'jsonl' | 'pcap-ng';
		datasourceIds?: string[];
	};
	/** Explicit recents bypass remembered defaults, including their output choice. */
	restoreDefaults?: boolean;
}

export interface EmbeddableAppProps {
	/** Desktop route, including query parameters. Defaults to `/`. */
	path?: string;
	/** Optional plain host-specific heading; omitted keeps the Desktop greeting and gradient. */
	homeTitle?: string;
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
	/** Opt in to outcome-based output, host-protected per-image defaults, and choose-file-and-start. */
	launchPreferences?: boolean;
	/** Focus the Run button when the launcher becomes ready, unless the user has focused another control. */
	focusLaunchAction?: boolean;
	/** Explicit native host capability. Omit it to keep browser/Insights behavior unchanged. */
	fileOutput?: {
		formats: ('jsonl' | 'pcap-ng')[];
		host: string;
		/** The embedding host presents completion/errors itself. */
		notify?: boolean;
	};
}
