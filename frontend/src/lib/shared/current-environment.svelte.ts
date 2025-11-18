import type { Environment } from '$lib/types';

/**
 * State for tracking the currently viewed environment and its connection status.
 */
class CurrentEnvironmentState {
	environment = $state<Environment | null>(null);
	connectionStatus = $state<'connecting' | 'connected' | 'error'>('connecting');
	errorMessage = $state<string | null>(null);

	/**
	 * Set the current environment being viewed.
	 */
	setEnvironment(env: Environment | null): void {
		this.environment = env;
		// Reset connection status when changing environments
		if (env) {
			this.connectionStatus = 'connecting';
			this.errorMessage = null;
		}
	}

	/**
	 * Update the connection status of the current environment.
	 */
	setConnectionStatus(status: 'connecting' | 'connected' | 'error', errorMessage?: string): void {
		this.connectionStatus = status;
		this.errorMessage = errorMessage || null;
	}

	/**
	 * Clear the current environment (e.g., when navigating away).
	 */
	clear(): void {
		this.environment = null;
		this.connectionStatus = 'connecting';
		this.errorMessage = null;
	}

	/**
	 * Get formatted status text for display.
	 */
	getStatusText(): string {
		if (!this.environment) {
			return '';
		}

		const envName = this.environment.name;
		let runtime: string;

		if (this.environment.runtime === 'grpc-ig') {
			runtime = this.environment.params?.['remote-address'] || 'Remote';
		} else {
			// For Kubernetes, include context if available
			const context = this.environment.params?.['context'];
			runtime = context ? `Kubernetes (${context})` : 'Kubernetes';
		}

		switch (this.connectionStatus) {
			case 'connecting':
				return `Connecting to ${envName} on ${runtime}...`;
			case 'connected':
				return `Connected to ${envName} on ${runtime}`;
			case 'error':
				return this.errorMessage || `Failed to connect to ${envName}`;
		}
	}

	/**
	 * Check if the current environment has TLS encryption enabled.
	 * Kubernetes connections are always secure.
	 */
	hasTLS(): boolean {
		if (!this.environment) {
			return false;
		}
		// Kubernetes connections are always secure
		if (this.environment.runtime !== 'grpc-ig') {
			return true;
		}
		// For grpc-ig, check if TLS is configured
		return !!(this.environment.params && this.environment.params['tls-key-file']);
	}
}

/**
 * Singleton instance for tracking the current environment.
 */
export const currentEnvironment = new CurrentEnvironmentState();
