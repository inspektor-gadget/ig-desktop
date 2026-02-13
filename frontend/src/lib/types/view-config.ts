/**
 * Controls which UI panels are visible in the Gadget component.
 * All properties default to true when omitted.
 */
export interface ViewConfig {
	/** Play/stop buttons + running status + elapsed time + event count */
	statusBar?: boolean;
	/** Right sidebar settings panel */
	inspector?: boolean;
	/** Bottom log pane */
	logPanel?: boolean;
	/** Datasource tab header in DatasourceView */
	datasourceTabs?: boolean;
	/** Search input + filter/highlight controls */
	searchBar?: boolean;
	/** Snapshot timeline + navigation bar for array datasources */
	snapshotTimeline?: boolean;
}

const VIEW_CONFIG_DEFAULTS: Required<ViewConfig> = {
	statusBar: true,
	inspector: true,
	logPanel: true,
	datasourceTabs: true,
	searchBar: true,
	snapshotTimeline: true,
};

/** Merge a partial ViewConfig with defaults, returning a fully-resolved config. */
export function resolveViewConfig(config?: ViewConfig): Required<ViewConfig> {
	if (!config) return { ...VIEW_CONFIG_DEFAULTS };
	return { ...VIEW_CONFIG_DEFAULTS, ...config };
}
