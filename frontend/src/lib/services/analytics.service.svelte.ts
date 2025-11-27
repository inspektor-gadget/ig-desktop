/**
 * Analytics service
 * Manages PostHog initialization and event tracking with privacy-first approach
 */

import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { configuration } from '$lib/stores/configuration.svelte';

class AnalyticsService {
	private initialized = false;

	/**
	 * Initialize PostHog only if user has opted in
	 */
	initialize(): void {
		if (!browser || this.initialized) return;

		const analyticsEnabled = configuration.get('sendAnalytics');
		if (!analyticsEnabled) return;

		posthog.init('phc_C7CCdnT1giPAEHM6aTUJY0BzZfOrtLV3Dzpu3485Pds', {
			api_host: 'https://eu.i.posthog.com',
			defaults: '2025-05-24',
			person_profiles: 'identified_only',
			autocapture: false,
			capture_pageview: false,
			capture_pageleave: false,
			cookieless_mode: 'always'
		});

		this.initialized = true;
	}

	/**
	 * Disable analytics and reset PostHog
	 */
	disable(): void {
		if (!browser || !this.initialized) return;

		posthog.opt_out_capturing();
		posthog.reset();
		this.initialized = false;
	}

	/**
	 * Check if a gadget URL should be tracked
	 * Only track:
	 * - Short form URLs (no registry prefix, e.g., "trace_open")
	 * - URLs specifically from ghcr.io/inspektor-gadget/
	 */
	private shouldTrackGadgetUrl(url: string): boolean {
		if (!url) return false;

		// Short form: no slashes means it's a simple gadget name
		if (!url.includes('/')) {
			return true;
		}

		// Only allow ghcr.io/inspektor-gadget/ prefix
		if (url.startsWith('ghcr.io/inspektor-gadget/')) {
			return true;
		}

		return false;
	}

	/**
	 * Track a RunGadget event if conditions are met
	 */
	trackRunGadget(url: string): void {
		if (!browser || !this.initialized) return;

		const analyticsEnabled = configuration.get('sendAnalytics');
		if (!analyticsEnabled) return;

		if (!this.shouldTrackGadgetUrl(url)) return;

		posthog.capture('RunGadget', {
			gadget_url: url
		});
	}

	/**
	 * Check if analytics is currently enabled and initialized
	 */
	isEnabled(): boolean {
		return this.initialized && configuration.get('sendAnalytics') === true;
	}
}

export const analyticsService = new AnalyticsService();
