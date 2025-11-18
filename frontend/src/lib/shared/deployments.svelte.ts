import type { Deployments, DeploymentProgress, DeploymentConfig } from '$lib/types';

class DeploymentsStore {
	deployments = $state<Deployments>({});

	create(config: DeploymentConfig): string {
		const id = `deploy-${Date.now()}`;
		this.deployments[id] = {
			id,
			status: 'configuring',
			config,
			progress: 0,
			logs: [],
			debugLogs: [],
			timestamp: Date.now()
		};
		return id;
	}

	update(id: string, updates: Partial<DeploymentProgress>): void {
		if (this.deployments[id]) {
			this.deployments[id] = {
				...this.deployments[id],
				...updates
			};
		}
	}

	addLog(id: string, log: string): void {
		if (this.deployments[id]) {
			this.deployments[id].logs.push(log);
		}
	}

	addDebugLog(id: string, log: string): void {
		if (this.deployments[id]) {
			this.deployments[id].debugLogs.push(log);
		}
	}

	remove(id: string): void {
		delete this.deployments[id];
	}

	get(id: string): DeploymentProgress | undefined {
		return this.deployments[id];
	}

	getActive(): DeploymentProgress | undefined {
		return Object.values(this.deployments).find(
			(d) => d.status === 'deploying' || d.status === 'configuring'
		);
	}

	clearCompleted(): void {
		Object.keys(this.deployments).forEach((id) => {
			const deployment = this.deployments[id];
			if (deployment.status === 'success' || deployment.status === 'error') {
				delete this.deployments[id];
			}
		});
	}
}

export const deployments = new DeploymentsStore();
