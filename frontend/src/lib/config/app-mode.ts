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

/**
 * App mode determines which features are available.
 * Set via VITE_APP_MODE environment variable at build time.
 *
 * - 'full': All features enabled (default, for desktop app)
 * - 'single-env': Single pre-configured environment, no create/delete (for hosted deployments)
 * - 'demo': Static demo mode with pre-recorded sessions, no backend required
 */
export type AppMode = 'full' | 'single-env' | 'demo';

// Read from build-time environment variable, default to 'full'
export const APP_MODE: AppMode = (import.meta.env.VITE_APP_MODE as AppMode) || 'full';

/**
 * Feature flags derived from the app mode.
 * Use these throughout the app to conditionally render UI and enable/disable functionality.
 */
export const features = {
	/** Whether users can create new environments */
	canCreateEnvironment: APP_MODE === 'full',

	/** Whether users can delete environments */
	canDeleteEnvironment: APP_MODE === 'full',

	/** Whether users can run new gadgets (disabled in demo mode) */
	canRunGadgets: APP_MODE !== 'demo',

	/** Whether ArtifactHub browsing is available (requires backend) */
	canBrowseArtifactHub: APP_MODE !== 'demo',

	/** Whether the app has a live backend connection */
	hasBackend: APP_MODE !== 'demo',

	/** Whether only a single environment is available */
	isSingleEnvironment: APP_MODE === 'single-env',

	/** Whether the app is in demo mode */
	isDemoMode: APP_MODE === 'demo'
} as const;
