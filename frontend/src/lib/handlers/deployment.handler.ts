import { deployments } from '$lib/shared/deployments.svelte';

/**
 * Parse deployment data, handling both string and object formats.
 */
function parseDeploymentData(data: any): any {
	return typeof data === 'string' ? JSON.parse(data) : data;
}

/**
 * Handle deployment progress update (type 200).
 * Updates progress percentage and current step message.
 */
export function handleDeploymentProgress(msg: any): void {
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
		deployments.addLog(progressData.deploymentId, progressData.message);
	} else {
		console.error('[Layout] Deployment progress missing deploymentId:', progressData);
	}
}

/**
 * Handle deployment completion (type 201).
 * Marks the deployment as successfully completed.
 */
export function handleDeploymentComplete(msg: any): void {
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
export function handleDeploymentError(msg: any): void {
	const errorData = parseDeploymentData(msg.data);
	console.log('[Layout] Deployment error event:', errorData);

	if (errorData.deploymentId) {
		deployments.addDebugLog(errorData.deploymentId, `[WS] Error: ${errorData.error}`);
		deployments.update(errorData.deploymentId, {
			status: 'error',
			error: errorData.error,
			completedAt: Date.now()
		});
		if (errorData.error) {
			deployments.addLog(errorData.deploymentId, `Error: ${errorData.error}`);
		}
	} else {
		console.error('[Layout] Deployment error missing deploymentId:', errorData);
	}
}
