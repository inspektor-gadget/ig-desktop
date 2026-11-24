// Common TypeScript interfaces for the IG Frontend

import type { EventRingBuffer } from '#lib/utils/ring-buffer.ts';

// Re-export context types
export type { ApiContext, GadgetContext, InspectSnapshot } from './context';

export interface Environment {
	id: string;
	name: string;
	runtime: string;
	params?: Record<string, string>;
}

export interface Environments {
	[key: string]: Environment;
}

export interface GadgetInstance {
	id: string;
	name: string;
	tags?: string;
	gadgetConfig?: {
		imageName?: string;
	};
}

export interface GadgetRunRequest {
	image: string;
	detached?: boolean;
	params?: Record<string, unknown>;
	environmentID?: string;
	instanceName?: string;
	timestamp?: number;
	record?: boolean;
	sessionId?: string;
	sessionName?: string;
	/** Opt-in embedding host persists custom options after an acknowledged start. */
	rememberOptions?: boolean;
	/** File output is host-authorized and is intentionally not a persisted path. */
	output?: FileOutputRequest;
}

export type FileOutputFormat = 'jsonl' | 'pcap-ng';

export interface FileOutputRequest {
	/** Present only for a newly host-authorized run, never for a saved preset. */
	token?: string;
	format: FileOutputFormat;
	datasourceIds?: string[];
}

export interface FileOutputCapability {
	formats: FileOutputFormat[];
	host: string;
	/** `false`: the embedding host presents capture completion/errors itself (no shared toasts). */
	notify?: boolean;
}

export interface FileCaptureStatus {
	format: FileOutputFormat;
	path: string;
	partialPath?: string;
	/** Original destination preserved during an explicitly confirmed replacement. */
	recoveryPath?: string;
	host: string;
	state: 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'unknown';
	records: number;
	bytes: number;
	error?: string;
	datasourceIds?: string[];
}

export interface GadgetInfo {
	imageName?: string;
	params?: GadgetParam[];
	datasources?: GadgetDatasource[];
	dataSources?: GadgetDatasource[]; // Backend sends camelCase
	[key: string]: unknown;
}

export interface GadgetParam {
	key: string;
	prefix?: string;
	alias?: string;
	title?: string;
	description?: string;
	defaultValue?: string;
	typeHint?: string;
	valueHint?: string;
	possibleValues?: string[];
	tags?: string[];
	[key: string]: unknown;
}

/**
 * Configuration object passed to parameter editor components.
 * Provides get/set methods for parameter values.
 */
export interface ParamConfig {
	get: (param: GadgetParam) => string | undefined;
	set: (param: GadgetParam, value: string | undefined) => void;
	getAll: () => Record<string, string>;
	getByValueHint: (valueHint: string) => string | undefined;
	valueHintToKey: Record<string, string>;
}

export interface GadgetDatasource {
	id?: number;
	name: string;
	fields?: GadgetDatasourceField[];
	annotations?: Record<string, string>;
	[key: string]: unknown;
}

export interface GadgetDatasourceField {
	name: string;
	fullName: string;
	kind: string;
	flags?: number;
	tags?: string[];
	annotations?: Record<string, string>;
	order?: number;
	[key: string]: unknown;
}

export interface RuntimeInfo {
	key: string;
	title: string;
	description: string;
	contexts?: string[];
}

export interface SessionInfo {
	sessionId: string;
	runId: string;
	isNew: boolean;
}

/**
 * Log entry from gadget execution.
 */
export interface LogEntry {
	msg: string;
	severity: number | string;
	timestamp?: string;
	msgID?: string;
}

export interface GadgetInstanceData {
	name: string;
	running: boolean;
	gadgetInfo: GadgetInfo;
	events: EventRingBuffer<Record<string, unknown>>;
	logs: LogEntry[];
	environment: string;
	startTime: number;
	eventCount: number;
	session?: SessionInfo;
	attached?: boolean;
	output?: FileCaptureStatus;
	[key: string]: unknown;
}

export interface Instances {
	[key: string]: GadgetInstanceData;
}

export type DeploymentStatus = 'configuring' | 'deploying' | 'success' | 'error';

export interface DeploymentConfig {
	environmentID?: string;
	namespace: string;
	releaseName: string;
	chartVersion?: string;
	customValues?: string;
	kubeContext?: string; // Kubernetes context for multi-context support
}

export interface DeploymentResourceConflict {
	apiVersion: string;
	kind: string;
	namespace: string;
	name: string;
	uid: string;
	resourceVersion: string;
	blockedReason?: string;
}

export interface DeploymentProgress {
	id: string;
	status: DeploymentStatus;
	config: DeploymentConfig;
	progress: number; // 0-100
	currentStep?: string;
	logs: string[];
	debugLogs: string[]; // Raw debug/system logs
	error?: string;
	ownershipConflict?: boolean;
	resourceConflicts?: DeploymentResourceConflict[];
	timestamp: number;
	completedAt?: number;
}

export interface Deployments {
	[key: string]: DeploymentProgress;
}

export interface IGDeploymentStatus {
	deployed: boolean;
	missing?: boolean;
	namespace?: string;
	version?: string;
	error?: string;
}

export interface SessionItem {
	id: string;
	name: string;
	environmentId: string;
	createdAt: number;
	updatedAt: number;
	runCount: number;
}

export interface GadgetRun {
	id: string;
	sessionId: string;
	gadgetImage: string;
	params: Record<string, string>;
	gadgetInfo: GadgetInfo;
	startedAt: number;
	stoppedAt: number;
	eventCount: number;
}

export interface SessionWithRuns extends SessionItem {
	runs: GadgetRun[];
}

export interface RecordedEvent {
	id: number;
	runId: string;
	timestamp: number;
	type: number;
	datasourceId?: string;
	data: unknown;
}

/**
 * Base message structure from backend
 */
export interface GadgetMessageBase {
	instanceID: string;
	datasourceID?: string;
	environmentID?: string;
	sessionInfo?: SessionInfo;
	attached?: boolean;
	instanceName?: string;
}

/**
 * Message for gadget info (type 2)
 */
export interface GadgetInfoMessage extends GadgetMessageBase {
	data: GadgetInfo;
}

/**
 * Message for gadget events (type 3)
 */
export interface GadgetEventMessage extends GadgetMessageBase {
	data: Record<string, unknown>;
}

/**
 * Message for gadget logs (type 4)
 */
export interface GadgetLogMessage extends GadgetMessageBase {
	data: LogEntry;
}

/**
 * Message for gadget quit (type 5)
 */
export interface GadgetQuitMessage {
	instanceID: string;
	data?: { output?: FileCaptureStatus };
}

/** File output progress (message type 7). */
export interface GadgetFileOutputMessage extends GadgetMessageBase {
	data: FileCaptureStatus;
}

/**
 * Message for array data (type 6)
 */
export interface GadgetArrayDataMessage extends GadgetMessageBase {
	data: Record<string, unknown>[];
}
