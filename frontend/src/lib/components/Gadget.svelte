<script lang="ts">
	import DatasourceView from './Gadget/DatasourceView.svelte';
	import Settings from './GadgetSettings.svelte';
	import Log from './Gadget/Log.svelte';
	import Input from './forms/Input.svelte';

	import Play from '$lib/icons/play-small.svg?raw';
	import Stop from '$lib/icons/stop-small.svg?raw';
	import Cog from '$lib/icons/cog.svg?raw';
	import FilterIcon from '$lib/icons/filter-small.svg?raw';
	import { instances } from '$lib/shared/instances.svelte';
	import { environments } from '$lib/shared/environments.svelte';
	import { getContext, setContext } from 'svelte';
	import { preferences } from '$lib/shared/preferences.svelte';
	import { configuration } from '$lib/stores/configuration.svelte';
	import { settingsDialog } from '$lib/stores/settings-dialog.svelte';

	let { instanceID }: { instanceID: string } = $props();

	let gadgetInfo = $derived(instances[instanceID]?.gadgetInfo);
	let events = $derived(instances[instanceID]?.events);
	let logs = $derived(instances[instanceID]?.logs);

	let logPane = $state<HTMLDivElement | null>(null);
	let inspectorPane = $state<HTMLDivElement | null>(null);
	let showInspector = $derived(preferences.getDefault('gadget.show-inspector', false));
	let logHeight = $derived(preferences.getDefault('gadget.log-height', 300));
	let logCollapsed = $derived(preferences.getDefault('log-panel-collapsed', true));
	let inspectorWidth = $derived(preferences.getDefault('gadget.inspector-width', 300));

	function resize(ev: PointerEvent) {
		ev.preventDefault();

		const startY = ev.clientY;
		const startHeight = logPane!.getBoundingClientRect().height;

		const onPointerMove = (e: PointerEvent) => {
			const dy = e.clientY - startY;

			const newHeight = Math.min(500, Math.max(20, startHeight - dy));
			requestAnimationFrame(() => {
				preferences.set('gadget.log-height', newHeight);
			});
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}

	function resizeSidebar(ev: PointerEvent) {
		ev.preventDefault();

		const startX = ev.clientX;
		const startWidth = inspectorPane!.getBoundingClientRect().width;

		const onPointerMove = (e: PointerEvent) => {
			const dy = e.clientX - startX;

			const newWidth = Math.min(700, Math.max(100, startWidth - dy));
			requestAnimationFrame(() => {
				preferences.set('gadget.inspector-width', newWidth);
			});
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}

	const gadget: { info?: typeof gadgetInfo } = $state({});
	setContext('gadget', gadget);

	// Update gadget context with gadget info when available
	$effect(() => {
		if (gadgetInfo) {
			gadget.info = gadgetInfo;
		}
	});

	const api = getContext<{ request: (opts: { cmd: string; data?: unknown }) => Promise<unknown> }>(
		'api'
	);

	// Search/filter state with debouncing
	let searchInput = $state('');
	let searchQuery = $state('');
	let searchInputRef: { focus: (selectAll?: boolean) => void } | undefined = $state();

	$effect(() => {
		// Track searchInput for reactivity
		const currentInput = searchInput;
		const timer = setTimeout(() => {
			searchQuery = currentInput;
		}, 150);
		return () => clearTimeout(timer);
	});

	const searchModeFilter = $derived((configuration.get('searchModeFilter') as boolean) ?? true);
	const searchHighlightInFilterMode = $derived(
		(configuration.get('searchHighlightInFilterMode') as boolean) ?? false
	);

	// Match navigation state
	let matchCount = $state(0);
	let totalCount = $state(0);
	let matchIndices = $state<number[]>([]);
	let currentMatchIndex = $state(-1);
	let scrollToIndex: ((index: number) => void) | null = $state(null);

	// Reset to first match when search query changes
	$effect(() => {
		searchQuery; // track dependency
		currentMatchIndex = -1;
	});

	function handleMatchInfo(info: {
		matchCount: number;
		totalCount: number;
		matchIndices: number[];
	}) {
		matchCount = info.matchCount;
		totalCount = info.totalCount;
		matchIndices = info.matchIndices;
		// Reset current match when matches change
		if (info.matchCount > 0 && currentMatchIndex >= info.matchCount) {
			currentMatchIndex = 0;
		} else if (info.matchCount === 0) {
			currentMatchIndex = -1;
		}
	}

	function handleScrollToIndex(fn: (index: number) => void) {
		scrollToIndex = fn;
	}

	function goToNextMatch() {
		if (matchCount === 0) return;
		currentMatchIndex = (currentMatchIndex + 1) % matchCount;
		if (scrollToIndex && matchIndices[currentMatchIndex] !== undefined) {
			scrollToIndex(matchIndices[currentMatchIndex]);
		}
	}

	function goToPrevMatch() {
		if (matchCount === 0) return;
		currentMatchIndex = currentMatchIndex <= 0 ? matchCount - 1 : currentMatchIndex - 1;
		if (scrollToIndex && matchIndices[currentMatchIndex] !== undefined) {
			scrollToIndex(matchIndices[currentMatchIndex]);
		}
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		// Only handle Enter in highlight mode (non-filter mode)
		if (e.key !== 'Enter' || searchModeFilter) return;

		e.preventDefault();
		if (e.shiftKey) {
			goToPrevMatch();
		} else {
			goToNextMatch();
		}
	}

	function toggleSearchMode() {
		configuration.set('searchModeFilter', !searchModeFilter);
	}

	function toggleHighlightInFilterMode() {
		configuration.set('searchHighlightInFilterMode', !searchHighlightInFilterMode);
	}

	function openSearchModeSettings() {
		settingsDialog.openTo('general', 'searchModeFilter');
	}

	function openHighlightSettings() {
		settingsDialog.openTo('general', 'searchHighlightInFilterMode');
	}

	// Global keyboard shortcut for search (Cmd+F on Mac, Ctrl+F on Windows/Linux)
	$effect(() => {
		function handleGlobalKeydown(e: KeyboardEvent) {
			// Check for Cmd+F (Mac) or Ctrl+F (Windows/Linux)
			if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				searchInputRef?.focus(true);
			}
		}

		window.addEventListener('keydown', handleGlobalKeydown);
		return () => window.removeEventListener('keydown', handleGlobalKeydown);
	});

	const instance = $derived(instances[instanceID]);
	const environmentName = $derived(
		instance?.environment ? environments[instance.environment]?.name : ''
	);

	let currentTime = $state(Date.now());

	$effect(() => {
		if (!instance?.running) return;

		const interval = setInterval(() => {
			currentTime = Date.now();
		}, 1000);

		return () => clearInterval(interval);
	});

	const elapsedTime = $derived.by(() => {
		if (!instance?.startTime || !instance?.running) return '';

		const elapsed = Math.floor((currentTime - instance.startTime) / 1000);
		const hours = Math.floor(elapsed / 3600);
		const minutes = Math.floor((elapsed % 3600) / 60);
		const seconds = elapsed % 60;

		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	});

	const eventCount = $derived(instance?.eventCount || 0);
	const displayedEventCount = $derived(events?.length || 0);
	const maxEventsConfig = $derived((configuration.get('maxEventsPerGadget') as number) || 500);
	const isCapped = $derived(eventCount > displayedEventCount);

	function openMaxEventsSettings() {
		settingsDialog.openTo('general', 'maxEventsPerGadget');
	}

	async function stopInstance(instanceID: string) {
		try {
			await api.request({ cmd: 'stopInstance', data: { id: instanceID } });
		} catch (err) {
			console.error('Failed to stop instance:', err);
		}
	}
</script>

{#if gadgetInfo}
	<div class="flex flex-1 flex-row overflow-hidden">
		<div class="flex flex-1 flex-col overflow-hidden">
			<div class="flex grow flex-col overflow-hidden">
				<div class="flex flex-row items-center justify-between p-2">
					<div class="flex flex-row items-center gap-2">
						<div class="flex flex-row items-center">
							<!-- Play/Stop button group -->
							<div class="flex">
								<div
									class="flex h-8 w-8 items-center justify-center rounded-l border transition-colors {instance.running
										? 'border-green-600 bg-green-600 text-white'
										: 'border-gray-600 bg-transparent text-gray-500'}"
									title={instance.running ? 'Running' : 'Stopped'}
								>
									{@html Play}
								</div>
								<button
									onclick={() => stopInstance(instanceID)}
									disabled={!instance.running}
									class="flex h-8 items-center justify-center gap-1 rounded-r border border-l-0 px-2 transition-colors {instance.running
										? 'border-gray-600 bg-transparent text-red-500 hover:bg-red-600 hover:text-white cursor-pointer'
										: 'border-red-800 bg-red-800 text-white cursor-default'}"
									title={instance.running
										? instance.attached
											? 'Detach from gadget (keeps running)'
											: 'Stop gadget'
										: instance.attached
											? 'Detached'
											: 'Stopped'}
								>
									{@html Stop}
									{#if instance.running && instance.attached}
										<span class="text-sm">Detach</span>
									{/if}
								</button>
							</div>
						</div>
						<div>
							{#if instance.running}
								Running
								{#if environmentName}{` on ${environmentName}`}{/if}
							{:else}
								{instance.attached ? 'Detached' : 'Stopped'}
							{/if}
						</div>
						{#if instance.isReplay}
							<div class="flex items-center gap-2 text-sm text-gray-400">
								{#if instance.replayMode === 'snapshot'}
									<span
										class="rounded border border-purple-700 bg-purple-900/50 px-2 py-0.5 text-xs font-semibold text-purple-300"
									>
										SNAPSHOT
									</span>
								{:else}
									<span
										class="rounded border border-blue-700 bg-blue-900/50 px-2 py-0.5 text-xs font-semibold text-blue-300 {instance.running
											? 'animate-pulse'
											: ''}"
									>
										REPLAY
									</span>
								{/if}
							</div>
						{/if}
						{#if instance.session}
							<span
								class="flex items-center gap-1 rounded border border-red-700 bg-red-900/50 px-2 py-0.5 text-xs font-semibold text-red-300"
							>
								<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500"></span>
								REC
							</span>
						{/if}
					</div>
					<div class="flex-1"></div>
					<div class="px-2 font-mono text-sm text-gray-400">
						{#if isCapped}
							<button
								onclick={openMaxEventsSettings}
								class="cursor-pointer hover:text-gray-200"
								title="Click to configure maximum events"
							>
								{displayedEventCount} of {eventCount} events
							</button>
						{:else}
							{eventCount} events
						{/if}
					</div>
					{#if elapsedTime}<div class="px-2 font-mono text-sm text-gray-400">
							{elapsedTime}
						</div>{/if}
					<div class="flex items-center px-2">
						<Input
							bind:this={searchInputRef}
							bind:value={searchInput}
							placeholder="Search..."
							class="text-sm rounded-r-none"
							onkeydown={handleSearchKeydown}
						/>
						<button
							onclick={toggleSearchMode}
							ondblclick={openSearchModeSettings}
							class="flex h-[38px] w-8 items-center justify-center border border-l-0 border-gray-800 transition-colors {searchModeFilter
								? 'bg-blue-600 text-white hover:bg-blue-500'
								: 'bg-gray-700 text-gray-300 hover:bg-gray-600'}"
							title={searchModeFilter
								? 'Filter mode: hiding non-matching entries (click to switch to highlight mode, double-click to open settings)'
								: 'Highlight mode: showing all entries with matches highlighted (click to switch to filter mode, double-click to open settings)'}
						>
							{@html FilterIcon}
						</button>
						<button
							onclick={toggleHighlightInFilterMode}
							ondblclick={openHighlightSettings}
							class="flex h-[38px] w-8 items-center justify-center border border-l-0 border-gray-800 transition-colors {searchHighlightInFilterMode
								? 'bg-yellow-600 text-white hover:bg-yellow-500'
								: 'bg-gray-700 text-gray-300 hover:bg-gray-600'} {!searchModeFilter && searchQuery
								? ''
								: 'rounded-r-lg'}"
							title={searchHighlightInFilterMode
								? 'Text highlighting enabled (click to disable, double-click to open settings)'
								: 'Text highlighting disabled (click to enable, double-click to open settings)'}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="currentColor"
							>
								<path
									d="M15.243 3.172a4 4 0 0 1 5.657 5.656l-8.486 8.486a2 2 0 0 1-.578.39l-4.243 1.768a1 1 0 0 1-1.287-1.287l1.768-4.243a2 2 0 0 1 .39-.578l8.486-8.486zM3 20h4a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2z"
								/>
							</svg>
						</button>
						{#if !searchModeFilter && searchQuery}
							<button
								onclick={goToPrevMatch}
								disabled={matchCount === 0}
								class="flex h-[38px] w-8 items-center justify-center border border-l-0 border-gray-800 bg-gray-700 text-gray-300 transition-colors hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
								title="Previous match (wraps around)"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<polyline points="15 18 9 12 15 6"></polyline>
								</svg>
							</button>
							<button
								onclick={goToNextMatch}
								disabled={matchCount === 0}
								class="flex h-[38px] w-8 items-center justify-center rounded-r-lg border border-l-0 border-gray-800 bg-gray-700 text-gray-300 transition-colors hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
								title="Next match (wraps around)"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<polyline points="9 18 15 12 9 6"></polyline>
								</svg>
							</button>
						{/if}
					</div>
					{#if searchQuery}
						<div class="px-2 font-mono text-sm text-gray-400">
							{#if searchModeFilter}
								{matchCount} of {totalCount}
							{:else if matchCount > 0}
								{currentMatchIndex + 1}/{matchCount}
							{:else}
								0 matches
							{/if}
						</div>
					{/if}
					<button
						class="cursor-pointer"
						onclick={() => {
							preferences.set('gadget.show-inspector', !showInspector);
						}}>{@html Cog}</button
					>
				</div>
				<div class="flex flex-1 flex-col justify-stretch overflow-y-auto overscroll-none">
					{#each gadgetInfo.dataSources as ds, id}
						{#if ds.annotations?.['view.hidden'] !== 'true'}
							<DatasourceView
								{ds}
								{instanceID}
								{events}
								eventVersion={eventCount}
								{searchQuery}
								{searchModeFilter}
								{searchHighlightInFilterMode}
								onMatchInfo={handleMatchInfo}
								{currentMatchIndex}
								onScrollToIndex={handleScrollToIndex}
								isRunning={instance.running}
							/>
						{/if}
					{/each}
				</div>
			</div>
			{#if !logCollapsed}
				<div
					class="h-2 cursor-ns-resize touch-none bg-gray-800 select-none"
					onpointerdown={resize}
				></div>
			{/if}
			<div
				bind:this={logPane}
				class="flex flex-col overflow-hidden"
				style={logCollapsed ? 'flex: 0 0 auto' : `flex: 0 0 ${logHeight}px`}
			>
				<Log log={logs} {instanceID} />
			</div>
		</div>
		{#if showInspector}
			<div
				class="w-1 cursor-ew-resize touch-none border-r-1 border-r-gray-600 bg-gray-800 select-none"
				onpointerdown={resizeSidebar}
			></div>
			<div
				bind:this={inspectorPane}
				class="flex flex-col overflow-auto"
				style="flex: 0 0 {inspectorWidth}px"
			>
				<div class="flex flex-1 flex-col overflow-hidden">
					<Settings
						{gadgetInfo}
						onclose={() => {
							preferences.set('gadget.show-inspector', false);
						}}
					/>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div
		class="flex flex-1 items-center justify-center bg-gray-900 align-middle font-mono text-gray-100"
	>
		<div>
			<div class="text-xl">Gadget Instance not found (yet)</div>
		</div>
	</div>
{/if}
