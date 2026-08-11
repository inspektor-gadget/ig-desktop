/**
 * Reactive DNS transaction correlation for visualizer components.
 *
 * Wraps the pure `computeDnsCorrelation` function with the impure bits both
 * DNS visualizers need: reacting to new events (`getVersion`), a
 * precisely-scheduled timer so quiet timeouts (no new events at all) still
 * render once their deadline passes, and suspending all of the above while
 * the visualizer's tab is inactive (hidden but still mounted) so up to two
 * DNS visualizers don't both re-sort/re-correlate up to 10k events on every
 * event batch when only one is actually visible.
 */

import { onDestroy, untrack } from 'svelte';
import { computeDnsCorrelation } from './dnsCorrelator';
import type { DnsCorrelationResult, DnsFieldConfig } from './dnsTypes';

export interface DnsCorrelationSource {
	/** Current raw trace_dns events (from the ring buffer or snapshot). */
	getEvents: () => Record<string, unknown>[];
	/** Field mapping for the datasource, or null if not applicable. */
	getConfig: () => DnsFieldConfig | null;
	/** Response timeout in ms. */
	getTimeoutMs: () => number;
	/** Version counter; a change triggers recomputation. */
	getVersion: () => number;
	/** Whether the gadget is currently running. When false, all pending transactions finalize immediately. */
	getIsRunning: () => boolean;
	/**
	 * Whether this visualizer's tab is currently active/visible. While
	 * inactive, recomputation and the sweep timer are both suspended (no
	 * CPU work, no scheduled timers) and the last computed result is kept
	 * frozen. As soon as it becomes active again, a fresh recompute runs
	 * immediately against the current time and events, so any timeout that
	 * should have fired while hidden is reflected right away.
	 */
	getIsActiveTab: () => boolean;
}

const EMPTY_RESULT: DnsCorrelationResult = {
	transactions: [],
	pendingCount: 0,
	nextDeadlineMs: null
};

const LIVE_REFRESH_INTERVAL_MS = 100;

/**
 * Create reactive DNS correlation state bound to a datasource's live events.
 * Must be called during component initialization (uses runes internally).
 */
export function createDnsCorrelation(source: DnsCorrelationSource): {
	readonly transactions: DnsCorrelationResult['transactions'];
	readonly pendingCount: number;
} {
	let result = $state<DnsCorrelationResult>(EMPTY_RESULT);
	let sweepTimer: ReturnType<typeof setTimeout> | undefined;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	let lastRefreshAt = Number.NEGATIVE_INFINITY;

	function clearSweepTimer() {
		if (sweepTimer !== undefined) {
			clearTimeout(sweepTimer);
			sweepTimer = undefined;
		}
	}

	function clearRefreshTimer() {
		if (refreshTimer !== undefined) {
			clearTimeout(refreshTimer);
			refreshTimer = undefined;
		}
	}

	function clearTimers() {
		clearSweepTimer();
		clearRefreshTimer();
	}

	function recompute() {
		clearRefreshTimer();
		const config = source.getConfig();
		if (!config) {
			result = EMPTY_RESULT;
			clearTimers();
			return;
		}

		if (!source.getIsActiveTab()) {
			// Inactive tab: freeze the last result and don't schedule a timer.
			// The next time this becomes active, the effect below re-runs
			// (getIsActiveTab is a tracked dependency) and recomputes fresh.
			clearTimers();
			return;
		}

		const isRunning = source.getIsRunning();
		// Once the gadget has stopped, no further events will arrive - force
		// every remaining pending request to finalize (as no-response) rather
		// than waiting out its deadline.
		const now = isRunning ? Date.now() : Number.POSITIVE_INFINITY;

		result = computeDnsCorrelation(source.getEvents(), config, now, {
			timeoutMs: source.getTimeoutMs()
		});
		lastRefreshAt = Date.now();

		clearSweepTimer();
		if (result.nextDeadlineMs !== null && isRunning) {
			const delay = Math.max(0, result.nextDeadlineMs - Date.now()) + 10;
			sweepTimer = setTimeout(scheduleRecompute, delay);
		}
	}

	function scheduleRecompute() {
		if (!source.getIsActiveTab()) {
			clearTimers();
			return;
		}

		const delay = Math.max(0, LIVE_REFRESH_INTERVAL_MS - (Date.now() - lastRefreshAt));
		if (delay === 0) {
			recompute();
		} else if (refreshTimer === undefined) {
			refreshTimer = setTimeout(recompute, delay);
		}
	}

	$effect(() => {
		// Re-run whenever new events arrive, the run state changes, or the tab
		// becomes active/inactive. `recompute` itself reads several other
		// values (config/events/timeout) that must NOT become additional
		// tracked dependencies of this effect - `untrack` scopes reactive
		// dependency collection to exactly the three reads above, so a
		// recompute that (for example) allocates new result objects can
		// never cause this same effect to re-trigger itself.
		source.getVersion();
		const isRunning = source.getIsRunning();
		const isActiveTab = source.getIsActiveTab();
		untrack(() => {
			if (!isActiveTab) {
				clearTimers();
				lastRefreshAt = Number.NEGATIVE_INFINITY;
			} else if (!isRunning || lastRefreshAt === Number.NEGATIVE_INFINITY) {
				clearTimers();
				recompute();
			} else {
				scheduleRecompute();
			}
		});
	});

	onDestroy(clearTimers);

	return {
		get transactions() {
			return result.transactions;
		},
		get pendingCount() {
			return result.pendingCount;
		}
	};
}
