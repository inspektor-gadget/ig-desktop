<script lang="ts">
	import Bug from '$lib/icons/bug.svg?raw';
	import Filter from '$lib/icons/filter-small.svg?raw';
	import Trash from '$lib/icons/trash-small.svg?raw';
	import { preferences } from '$lib/shared/preferences.svelte';
	import { instances } from '$lib/shared/instances.svelte';

	interface LogEntry {
		msg: string;
		severity: number | string;
		timestamp?: string;
		msgID?: string;
	}

	let { log, instanceID }: { log: LogEntry[]; instanceID?: string } = $props();

	function clearLogs() {
		if (instanceID && instances[instanceID]) {
			instances[instanceID].logs = [];
		}
	}

	let element: HTMLDivElement;
	let dropdownOpen = $state(false);
	let dropdownButton: HTMLButtonElement;

	// Collapsed state - default collapsed, persisted globally
	const savedCollapsed = preferences.get('log-panel-collapsed') as boolean | undefined;
	let collapsed = $state(savedCollapsed ?? true);

	function toggleCollapsed() {
		collapsed = !collapsed;
		preferences.set('log-panel-collapsed', collapsed);
	}

	// Severity levels with display names
	const severityLevels = [
		{ key: 'panic', numeric: 0, label: 'Panic' },
		{ key: 'fatal', numeric: 1, label: 'Fatal' },
		{ key: 'error', numeric: 2, label: 'Error' },
		{ key: 'warning', numeric: 3, label: 'Warning' },
		{ key: 'info', numeric: 4, label: 'Info' },
		{ key: 'debug', numeric: 5, label: 'Debug' },
		{ key: 'trace', numeric: 6, label: 'Trace' }
	];

	// Default enabled: panic, fatal, error, warning, info (not debug, trace)
	const defaultEnabledSeverities = ['panic', 'fatal', 'error', 'warning', 'info'];

	// Load from preferences or use defaults
	const savedSeverities = preferences.get('log-severity-filter') as string[] | undefined;
	let enabledSeverities = $state(new Set(savedSeverities ?? defaultEnabledSeverities));

	$effect(() => {
		if (log && !collapsed && element) scrollToBottom(element);
	});

	let search = $state('');

	// Normalize severity to string key
	function normalizeSeverity(severity: number | string): string {
		if (typeof severity === 'number') {
			const level = severityLevels.find((s) => s.numeric === severity);
			return level?.key ?? 'info';
		}
		return severity;
	}

	let entries = $derived.by(() => {
		if (!log) return [];
		const lowerSearch = search.toLowerCase();
		return log.filter((e: LogEntry) => {
			// Filter by severity
			const severityKey = normalizeSeverity(e.severity);
			if (!enabledSeverities.has(severityKey)) return false;
			// Filter by search text
			if (search && !e.msg.toLowerCase().includes(lowerSearch)) return false;
			return true;
		});
	});

	const scrollToBottom = async (node: HTMLDivElement) => {
		node.scroll({ top: node.scrollHeight, behavior: 'smooth' });
	};

	function toggleSeverity(key: string) {
		if (enabledSeverities.has(key)) {
			enabledSeverities.delete(key);
		} else {
			enabledSeverities.add(key);
		}
		enabledSeverities = new Set(enabledSeverities);
		// Save to preferences
		preferences.set('log-severity-filter', Array.from(enabledSeverities));
	}

	function handleClickOutside(event: MouseEvent) {
		if (dropdownOpen && dropdownButton && !dropdownButton.contains(event.target as Node)) {
			const dropdown = document.getElementById('severity-dropdown');
			if (dropdown && !dropdown.contains(event.target as Node)) {
				dropdownOpen = false;
			}
		}
	}

	function formatTimestamp(timestamp?: string): string {
		if (timestamp) return `[${timestamp}]`;
		// Fallback for logs without timestamp
		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, '0');
		return `[${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;
	}

	// Get severity class name
	function getSeverityClass(severity: number | string): string {
		return `log-severity-${normalizeSeverity(severity)}`;
	}

	// Check for errors and warnings in logs
	const errorSeverities = ['panic', 'fatal', 'error'];
	const warningSeverities = ['warning'];

	const hasErrors = $derived.by(() => {
		if (!log) return false;
		return log.some((e) => errorSeverities.includes(normalizeSeverity(e.severity)));
	});

	const hasWarnings = $derived.by(() => {
		if (!log) return false;
		return log.some((e) => warningSeverities.includes(normalizeSeverity(e.severity)));
	});
</script>

<svelte:document onclick={handleClickOutside} />

<div class="sticky left-0 flex flex-row items-center justify-between bg-gray-950 px-2 py-1.5">
	<div class="flex flex-row items-center">
		<!-- Collapse/Expand Chevron -->
		<button
			onclick={toggleCollapsed}
			class="mr-1 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
			aria-label={collapsed ? 'Expand logs' : 'Collapse logs'}
		>
			<svg
				class="h-4 w-4 transition-transform duration-200 {collapsed ? '' : 'rotate-90'}"
				viewBox="0 0 20 20"
				fill="currentColor"
			>
				<path
					fill-rule="evenodd"
					d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>
		<div class="pr-2">{@html Bug}</div>
		<h2 class="text-sm font-medium">Log</h2>
		{#if hasErrors}
			<!-- Red octagon (stop sign) for errors -->
			<svg class="ml-2 h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="currentColor">
				<path
					d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2zM12 8a1 1 0 00-1 1v4a1 1 0 002 0V9a1 1 0 00-1-1zm0 8a1 1 0 100-2 1 1 0 000 2z"
				/>
			</svg>
		{:else if hasWarnings}
			<!-- Orange warning triangle -->
			<svg class="ml-2 h-4 w-4 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
				<path
					d="M12 2L1 21h22L12 2zm0 4.5l7.53 13.5H4.47L12 6.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"
				/>
			</svg>
		{/if}
	</div>
	{#if !collapsed}
		<div class="flex flex-row items-center gap-2">
			<!-- Severity Filter Dropdown -->
			<div class="relative">
				<button
					bind:this={dropdownButton}
					onclick={() => (dropdownOpen = !dropdownOpen)}
					class="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800/50 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
				>
					<span class="h-4 w-4">{@html Filter}</span>
					<span>Severity</span>
					<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path
							fill-rule="evenodd"
							d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
				{#if dropdownOpen}
					<div
						id="severity-dropdown"
						class="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-gray-800 bg-gray-900 py-1 shadow-xl"
					>
						{#each severityLevels as level}
							<label
								class="flex cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-gray-800/50"
							>
								<input
									type="checkbox"
									checked={enabledSeverities.has(level.key)}
									onchange={() => toggleSeverity(level.key)}
									class="h-4 w-4 cursor-pointer rounded border-gray-700 bg-gray-800 text-blue-500 transition-colors focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0"
								/>
								<span class="text-sm text-gray-300">{level.label}</span>
							</label>
						{/each}
					</div>
				{/if}
			</div>
			<!-- Search Input -->
			<input
				class="w-48 rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-sm text-gray-200 transition-colors placeholder:text-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
				type="text"
				placeholder="Search logs..."
				bind:value={search}
			/>
			<!-- Clear Logs Button -->
			<button
				onclick={clearLogs}
				class="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-red-700 hover:bg-red-900/30 hover:text-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 focus:outline-none"
				title="Clear logs"
			>
				<span class="h-4 w-4">{@html Trash}</span>
			</button>
		</div>
	{/if}
</div>
{#if !collapsed}
	<div bind:this={element} class="shrink grow overflow-auto bg-gray-900 p-2 font-mono text-xs">
		{#each entries as entry, i (entry.msgID ?? i)}
			<div class={getSeverityClass(entry.severity)}>
				<span class="text-gray-500">{formatTimestamp(entry.timestamp)}</span>
				{entry.msg}
			</div>
		{/each}
	</div>
{/if}

<style>
	:global {
		.log-severity-trace {
			color: var(--color-gray-500);
		}
		.log-severity-debug {
			color: var(--color-gray-400);
		}
		.log-severity-info {
			color: var(--color-gray-100);
		}
		.log-severity-warning {
			color: var(--color-orange-400);
		}
		.log-severity-error {
			color: var(--color-red-500);
		}
		.log-severity-fatal {
			color: var(--color-red-600);
		}
		.log-severity-panic {
			color: var(--color-white);
			background-color: var(--color-red-700);
		}
	}
</style>
