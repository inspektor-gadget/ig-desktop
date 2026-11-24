import { deployments } from '#lib/shared/deployments.svelte.ts';
import type { DeploymentResourceConflict } from '#lib/types/index.ts';

interface DeploymentEventData {
	deploymentId?: string;
	progress?: number;
	message?: string;
	error?: string;
	ownershipConflict?: boolean;
	resourceConflicts?: unknown;
}

function isResourceConflict(value: unknown): value is DeploymentResourceConflict {
	return (
		value !== null &&
		typeof value === 'object' &&
		'apiVersion' in value &&
		typeof value.apiVersion === 'string' &&
		'kind' in value &&
		typeof value.kind === 'string' &&
		'namespace' in value &&
		typeof value.namespace === 'string' &&
		'name' in value &&
		typeof value.name === 'string' &&
		'uid' in value &&
		typeof value.uid === 'string' &&
		'resourceVersion' in value &&
		typeof value.resourceVersion === 'string' &&
		(!('blockedReason' in value) || typeof value.blockedReason === 'string')
	);
}

/**
 * Parse deployment data, handling both string and object formats.
 */
function parseDeploymentData(data: unknown): DeploymentEventData {
	return (typeof data === 'string' ? JSON.parse(data) : data) as DeploymentEventData;
}

/**
 * Handle deployment progress update (type 200).
 * Updates progress percentage and current step message.
 */
export function handleDeploymentProgress(msg: { data?: unknown }): void {
	const progressData = parseDeploymentData(msg.data);
	console.log('[Layout] Deployment progress event:', progressData);

	if (progressData.deploymentId) {
		deployments.addDebugLog(
			progressData.deploymentId,
			`[WS] Progress: ${progressData.progress}% - ${progressData.message}`
		);
		deployments.update(progressData.deploymentId, {
			progress: progressData.progress,
			currentStep: progressData.message
		});
		deployments.addLog(progressData.deploymentId, progressData.message ?? '');
	} else {
		console.error('[Layout] Deployment progress missing deploymentId:', progressData);
	}
}

/**
 * Handle deployment completion (type 201).
 * Marks the deployment as successfully completed.
 */
export function handleDeploymentComplete(msg: { data?: unknown }): void {
	const completeData = parseDeploymentData(msg.data);
	console.log('[Layout] Deployment complete event:', completeData);

	if (completeData.deploymentId) {
		deployments.addDebugLog(completeData.deploymentId, '[WS] Deployment completed!');
		deployments.update(completeData.deploymentId, {
			status: 'success',
			progress: 100,
			completedAt: Date.now()
		});
		deployments.addLog(
			completeData.deploymentId,
			completeData.message || 'Deployment completed successfully'
		);
	} else {
		console.error('[Layout] Deployment complete missing deploymentId:', completeData);
	}
}

/**
 * Handle deployment error (type 202).
 * Marks the deployment as failed with an error message.
 */
export function handleDeploymentError(msg: { data?: unknown }): void {
	const errorData = parseDeploymentData(msg.data);
	console.log('[Layout] Deployment error event:', errorData);
	const resourceConflicts =
		Array.isArray(errorData.resourceConflicts) &&
		errorData.resourceConflicts.every(isResourceConflict)
			? errorData.resourceConflicts
			: undefined;
	const validConflicts =
		errorData.resourceConflicts === undefined || resourceConflicts !== undefined;
	const noCurrentConflicts = resourceConflicts?.length === 0;

	if (errorData.deploymentId) {
		deployments.addDebugLog(errorData.deploymentId, `[WS] Error: ${errorData.error}`);
		deployments.update(errorData.deploymentId, {
			status: 'error',
			error: !validConflicts
				? `${errorData.error ?? ''}\nInvalid resource conflict metadata. Retry deployment to inspect the current resources before cleanup.`
				: noCurrentConflicts
					? `${errorData.error ?? ''}\nNo current conflicting resource details are available. Retry deployment before cleanup.`
					: errorData.error,
			ownershipConflict:
				errorData.ownershipConflict === true && validConflicts && !noCurrentConflicts,
			resourceConflicts,
			completedAt: Date.now()
		});
		if (errorData.error) {
			deployments.addLog(errorData.deploymentId, `Error: ${errorData.error}`);
		}
	} else {
		console.error('[Layout] Deployment error missing deploymentId:', errorData);
	}
}
