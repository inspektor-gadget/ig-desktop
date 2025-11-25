/**
 * Chart type definitions for metrics visualization
 */

export interface DatasourceField {
	name: string;
	fullName: string;
	kind: string; // 'Uint64', 'Float64', 'String', 'Time', etc.
	order?: number;
	flags: number;
	tags?: string[];
	annotations: Record<string, string>;
}

export interface Datasource {
	name: string;
	fields: DatasourceField[];
	annotations?: Record<string, string>;
}

export interface ChartSeriesConfig {
	field: string;
	label: string;
	type: 'line' | 'area' | 'bar';
	color: string;
	fillOpacity?: number;
	/** Key value for filtering data when grouped by keys */
	keyValue?: string;
	/** Line interpolation: 'linear' for straight lines, 'smooth' for curves (default: 'linear') */
	interpolation?: 'linear' | 'smooth';
	/** Whether to show data point dots (default: false) */
	showDots?: boolean;
}

export interface ChartConfig {
	series: ChartSeriesConfig[];
	xField: string;
	yMin?: number;
	yMax?: number;
	showLegend?: boolean;
	showTooltip?: boolean;
}

export interface MetricDataPoint {
	timestamp: Date;
	[fieldName: string]: unknown;
}

export interface ChartDimensions {
	width: number;
	height: number;
	marginTop: number;
	marginRight: number;
	marginBottom: number;
	marginLeft: number;
	boundedWidth: number;
	boundedHeight: number;
}

/**
 * Extended event with batch metadata from array datasources
 */
export interface BatchedEvent extends Record<string, unknown> {
	/** When this batch was received */
	_receivedAt?: number;
	/** Links events from same snapshot batch */
	_batchId?: number;
	/** True if this is a synthetic zero-fill event */
	_filled?: boolean;
	/** Computed timestamp for charting */
	timestamp?: Date;
}

/**
 * Counter calculation modes for metrics.counter.mode annotation
 */
export type CounterMode = 'rate' | 'delta' | 'raw';

/**
 * Histogram configuration extracted from field annotations
 */
export interface HistogramConfig {
	/** Field containing bucket boundaries */
	bucketField: DatasourceField | null;
	/** Field containing count values for each bucket */
	countField: DatasourceField | null;
	/** Whether this datasource represents histogram data */
	isHistogram: boolean;
}

/**
 * Timestamp configuration extracted from datasource/field annotations
 */
export interface TimestampConfig {
	/** Field name to use as timestamp, or null if using _receivedAt */
	timestampField: string | null;
	/** Whether to use _receivedAt as the timestamp source */
	useReceivedAt: boolean;
}
