<script lang="ts">
	import { getContext } from 'svelte';
	import { page } from '$app/stores';
	import { formatAbsoluteTime, formatRelativeTime } from '$lib/utils/time';
	import type { SessionWithRuns } from '$lib/types';
	import { instances } from '$lib/shared/instances.svelte';
	import { ReplayService } from '$lib/services/replay.service';
	import { EventRingBuffer } from '$lib/utils/ring-buffer';
	import { configuration } from '$lib/stores/configuration.svelte';
	import Gadget from '$lib/components/Gadget.svelte';
	import Play from '$lib/icons/play-small.svg?raw';
	import Eye from '$lib/icons/fa/eye.svg?raw';
	import ChevronLeft from '$lib/icons/chevron-left.svg?raw';
	import Button from '$lib/components/Button.svelte';

	const api: any = getContext('api');
	const replayService = new ReplayService();

	let session = $state<SessionWithRuns | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let activeRunId = $state<string | null>(null);
	let activePlaybackMode = $state<'instant' | 'realtime'>('instant');
	let loadedRuns = $state<Set<string>>(new Set());
	let isPlaying = $state(false);
	let playbackProgress = $state<Map<string, number>>(new Map());

	const sessionId = $derived($page.params.id || '');

	$effect(() => {
		if (sessionId) {
			loadSession(sessionId);
		}
	});

	async function loadSession(id: string) {
		loading = true;
		error = null;
		try {
			session = await api.getSession(id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load session';
		} finally {
			loading = false;
		}
	}

	function getGadgetName(image: string): string {
		// Extract name from image URL
		return image.split('/').pop() || image;
	}

	async function viewResults(runId: string) {
		activePlaybackMode = 'instant';
		activeRunId = runId;
		await loadRunData(runId, 'instant');
		loadedRuns.add(runId);
	}

	async function playbackRealtime(runId: string) {
		activePlaybackMode = 'realtime';
		activeRunId = runId;
		await loadRunData(runId, 'realtime');
		loadedRuns.add(runId);
	}

	function getMaxEvents(): number {
		return (configuration.get('maxEventsPerGadget') as number) || 10000;
	}

	function createReplayInstance(
		instanceId: string,
		run: any,
		environmentId: string,
		mode: 'snapshot' | 'replay'
	) {
		instances[instanceId] = {
			name: run.gadgetImage,
			running: mode === 'replay',
			gadgetInfo: run.gadgetInfo,
			events: new EventRingBuffer(getMaxEvents()),
			logs: [],
			environment: environmentId,
			startTime: run.startedAt,
			eventCount: run.eventCount,
			isReplay: true,
			replayMode: mode,
			runId: run.id
		};
	}

	async function loadRunData(runId: string, mode: 'instant' | 'realtime') {
		if (!session) {
			error = 'Session not loaded';
			return;
		}

		const run = session.runs.find((r) => r.id === runId);
		if (!run) {
			error = 'Run not found';
			return;
		}

		const instanceId = `replay-${runId}`;
		const replayMode = mode === 'instant' ? 'snapshot' : 'replay';

		// Stop any current playback
		replayService.stop();
		isPlaying = false;

		// Clear previous events if reloading, or create new instance
		if (instances[instanceId]) {
			instances[instanceId].events.clear();
			instances[instanceId].logs = [];
			instances[instanceId].eventCount = 0;
			instances[instanceId].replayMode = replayMode;
			instances[instanceId].running = replayMode === 'replay';
		} else {
			createReplayInstance(instanceId, run, session.environmentId, replayMode);
		}

		// Handle empty runs
		if (run.eventCount === 0) {
			instances[instanceId].running = false;
			return;
		}

		// Fetch and replay events
		const events = await api.getRunEvents(session.id, runId);

		if (mode === 'realtime') {
			isPlaying = true;
		}

		await replayService.play({
			instanceId,
			events,
			mode,
			onComplete: () => {
				isPlaying = false;
				if (instances[instanceId]) {
					instances[instanceId].running = false;
				}
			},
			onProgress: (current, total) => {
				const progress = Math.round((current / total) * 100);
				if (activeRunId) {
					playbackProgress.set(activeRunId, progress);
				}
			}
		});
	}

	function stopPlayback() {
		replayService.stop();
		isPlaying = false;
		// Mark current replay instance as stopped
		if (activeRunId && instances[`replay-${activeRunId}`]) {
			instances[`replay-${activeRunId}`].running = false;
		}
	}

	// Clean up replay instances when component unmounts
	$effect(() => {
		return () => {
			replayService.stop();
			for (const runId of loadedRuns) {
				delete instances[`replay-${runId}`];
			}
		};
	});
</script>

{#if loading}
	<div class="flex flex-1 items-center justify-center p-8">
		<span class="text-gray-400">Loading session...</span>
	</div>
{:else if error}
	<div class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
		<p class="text-red-400">Error: {error}</p>
		<a href="/" class="text-blue-400 underline hover:text-blue-300">Return home</a>
	</div>
{:else if session}
	<div class="flex flex-1 flex-col overflow-auto">
		<header class="border-b border-gray-800 bg-gray-950/50 p-4">
			<div class="flex w-full items-center justify-between">
				<div class="flex items-center gap-3">
					<a
						href="/env/{session.environmentId}"
						class="flex cursor-pointer items-center rounded bg-gray-800 p-1.5 hover:bg-gray-700"
						title="Back to Environment"
					>
						{@html ChevronLeft}
					</a>
					<div>
						<h1 class="text-xl font-bold text-gray-100">
							{session.name || 'Unnamed Session'}
						</h1>
						<p class="text-sm text-gray-500">
							{session.runs.length} run{session.runs.length !== 1 ? 's' : ''}
							· Created
							<span class="cursor-help" title={formatAbsoluteTime(session.createdAt)}>
								{formatRelativeTime(session.createdAt)}
							</span>
						</p>
					</div>
				</div>
				{#if isPlaying}
					<div class="flex items-center gap-4">
						<span class="text-sm text-gray-400">Playing...</span>
						<button
							onclick={stopPlayback}
							class="rounded border border-red-800 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-900/20 hover:text-red-300"
						>
							Stop Playback
						</button>
					</div>
				{/if}
			</div>
		</header>

		<!-- Run panels -->
		{#if session.runs.length > 0}
			<div class="flex gap-2 overflow-x-auto border-b border-gray-800 bg-gray-950/60 px-2 py-2">
				{#each session.runs as run}
					<div
						class="flex items-center gap-3 rounded-lg border px-4 py-2 whitespace-nowrap transition-colors
							   {activeRunId === run.id
							? 'border-blue-500/50 bg-blue-900/20'
							: 'border-gray-700 bg-gray-800/50'}"
					>
						<div class="flex flex-col">
							<div class="text-sm font-medium text-gray-200">{getGadgetName(run.gadgetImage)}</div>
							<div class="text-xs text-gray-500">{run.eventCount} events</div>
						</div>
						<div class="flex items-center gap-1">
							<Button variant="secondary" size="sm" onclick={() => viewResults(run.id)}
								>{@html Eye}</Button
							>
							<Button variant="secondary" size="sm" onclick={() => playbackRealtime(run.id)}
								>{@html Play}</Button
							>
						</div>
					</div>
				{/each}
			</div>

			<!-- Run content -->
			<div class="flex flex-1 flex-col overflow-hidden bg-gray-950/80">
				{#if activeRunId}
					{@const instanceId = `replay-${activeRunId}`}
					{#if instances[instanceId]}
						<Gadget instanceID={instanceId} />
					{:else}
						<div class="flex flex-1 items-center justify-center p-8">
							<span class="text-gray-400">Loading run...</span>
						</div>
					{/if}
				{:else}
					<div class="flex flex-1 items-center justify-center p-8">
						<p class="text-gray-500">Select a run to view</p>
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex flex-1 items-center justify-center p-8">
				<p class="text-gray-500">No runs in this session</p>
			</div>
		{/if}
	</div>
{/if}
