// Copyright 2025 The Inspektor Gadget authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { Environment } from '$lib/types';
import { APP_MODE } from '$lib/config/app-mode';
import { base } from '$app/paths';

/**
 * Configuration for single-environment mode.
 * Loaded from /config.json when APP_MODE is 'single-env'.
 */
export interface SingleEnvConfig {
	environment: Environment;
	settings?: {
		/** Features to hide in the UI */
		hiddenFeatures?: string[];
	};
}

/**
 * Configuration for demo mode.
 * Loaded from /demo/config.json when APP_MODE is 'demo'.
 */
export interface DemoConfig {
	environment: Environment;
	/** Paths to session JSON files relative to /demo/sessions/ */
	sessions: string[];
}

/**
 * Load configuration for single-environment mode.
 * Returns null if not in single-env mode or if config fails to load.
 */
export async function loadSingleEnvConfig(): Promise<SingleEnvConfig | null> {
	if (APP_MODE !== 'single-env') return null;

	try {
		const response = await fetch(`${base}/config.json`);
		if (!response.ok) {
			console.error('Failed to load config.json:', response.status, response.statusText);
			return null;
		}
		return await response.json();
	} catch (err) {
		console.error('Error loading single-env config:', err);
		return null;
	}
}

/**
 * Load configuration for demo mode.
 * Returns null if not in demo mode or if config fails to load.
 */
export async function loadDemoConfig(): Promise<DemoConfig | null> {
	if (APP_MODE !== 'demo') return null;

	try {
		const response = await fetch(`${base}/demo/config.json`);
		if (!response.ok) {
			console.error('Failed to load demo config:', response.status, response.statusText);
			return null;
		}
		return await response.json();
	} catch (err) {
		console.error('Error loading demo config:', err);
		return null;
	}
}

/**
 * Load the appropriate configuration based on app mode.
 */
export async function loadAppConfig(): Promise<SingleEnvConfig | DemoConfig | null> {
	switch (APP_MODE) {
		case 'single-env':
			return loadSingleEnvConfig();
		case 'demo':
			return loadDemoConfig();
		default:
			return null;
	}
}
