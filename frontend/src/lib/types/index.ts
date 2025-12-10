// Common TypeScript interfaces for the IG Frontend

import type { EventRingBuffer } from '$lib/utils/ring-buffer';

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
	id: string;
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

export interface GadgetInstanceData {
	name: string;
	running: boolean;
	gadgetInfo: GadgetInfo;
	events: EventRingBuffer<Record<string, unknown>>;
	logs: Array<string | Record<string, unknown>>;
	environment: string;
	startTime: number;
	eventCount: number;
	session?: SessionInfo;
	attached?: boolean;
	[key: string]: unknown;
}

export interface Instances {
	[key: string]: GadgetInstanceData;
}

export type DeploymentStatus = 'configuring' | 'deploying' | 'success' | 'error';

export interface DeploymentConfig {
	namespace: string;
	releaseName: string;
	chartVersion?: string;
	customValues?: string;
	kubeContext?: string; // Kubernetes context for multi-context support
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
	timestamp: number;
	completedAt?: number;
}

export interface Deployments {
	[key: string]: DeploymentProgress;
}

export interface IGDeploymentStatus {
	deployed: boolean;
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
	data: string | Record<string, unknown>;
}

/**
 * Message for gadget quit (type 5)
 */
export interface GadgetQuitMessage {
	instanceID: string;
}

/**
 * Message for array data (type 6)
 */
export interface GadgetArrayDataMessage extends GadgetMessageBase {
	data: Record<string, unknown>[];
}
