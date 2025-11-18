// Common TypeScript interfaces for the IG Frontend

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
	params?: Record<string, any>;
	environmentID?: string;
	instanceName?: string;
	timestamp?: number;
}

export interface GadgetInfo {
	params?: any[];
	[key: string]: any;
}

export interface RuntimeInfo {
	key: string;
	title: string;
	description: string;
	contexts?: string[];
}

export interface Instances {
	[key: string]: {
		name: string;
		[key: string]: any;
	};
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
