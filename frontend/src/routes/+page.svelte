<script lang="ts">
	import { Browser } from '@wailsio/runtime';
	import { environments } from '$lib/shared/environments.svelte.js';
	import { goto } from '$app/navigation';
	import type { GadgetRunRequest } from '$lib/types';
	import { currentEnvironment } from '$lib/shared/current-environment.svelte';
	import { getEnvPref } from '$lib/utils/env-preferences';
	import { onMount } from 'svelte';

	import Panel from '$lib/components/Panel.svelte';
	import Server from '$lib/icons/fa/server.svg?raw';
	import History from '$lib/icons/fa/clock-rotate-left.svg?raw';
	import Grid from '$lib/icons/grid.svg?raw';
	import GridSmall from '$lib/icons/grid-small.svg?raw';
	import ChevronRight from '$lib/icons/chevron-right.svg?raw';
	import ArtifactHub from '$lib/icons/artifacthub-logo.svg?raw';
	import Book from '$lib/icons/book.svg?raw';
	import BookSmall from '$lib/icons/book-small.svg?raw';
	import Link from '$lib/icons/link.svg?raw';
	import CirclePlus from '$lib/icons/circle-plus.svg?raw';

	// Clear current environment when on home page
	$effect(() => {
		currentEnvironment.clear();
	});

	// Helper function to load all histories
	function loadHistories(): Array<{
		gadget: GadgetRunRequest;
		envId: string;
		envName: string;
	}> {
		const envList = Object.values(environments);
		const histories: Array<{
			gadget: GadgetRunRequest;
			envId: string;
			envName: string;
		}> = [];

		envList.forEach((env) => {
			const history = getEnvPref<GadgetRunRequest[]>(env.id, 'gadget-history') || [];
			history.forEach((gadget) => {
				histories.push({
					gadget,
					envId: env.id,
					envName: env.name
				});
			});
		});

		// Sort by timestamp (newest first) and return top 5
		return histories
			.sort((a, b) => (b.gadget.timestamp || 0) - (a.gadget.timestamp || 0))
			.slice(0, 5);
	}

	// Reactive state for all histories
	let allHistories = $state(loadHistories());

	// Reload when environments change
	$effect(() => {
		Object.values(environments); // Track dependencies
		allHistories = loadHistories();
	});

	// Listen to custom events to refresh when env prefs change
	onMount(() => {
		const handleEnvPrefChange = (e: CustomEvent) => {
			const key = e.detail?.key;
			if (key?.startsWith('env:') && key?.includes(':gadget-history')) {
				allHistories = loadHistories();
			}
		};
		window.addEventListener('envPrefChange', handleEnvPrefChange as EventListener);
		return () => window.removeEventListener('envPrefChange', handleEnvPrefChange as EventListener);
	});

	function formatRelativeTime(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return 'just now';
	}

	function getGadgetName(image: string): string {
		// Extract gadget name from image (e.g., "ghcr.io/inspektor-gadget/gadget/trace_exec:latest" -> "trace_exec")
		const parts = image.split('/');
		const lastPart = parts[parts.length - 1];
		return lastPart.split(':')[0];
	}

	function runGadget(gadget: GadgetRunRequest, envId: string) {
		const gadgetName = getGadgetName(gadget.image);
		goto(`/gadgets/run/${gadgetName}?env=${envId}&image=${encodeURIComponent(gadget.image)}`);
	}

	// Random tips
	const allTips = [
		{
			icon: GridSmall,
			title: 'MCP Server Available',
			description:
				'Did you know there is an Inspektor Gadget MCP Server? Click here to find out more!',
			color: 'blue',
			url: 'https://github.com/inspektor-gadget/ig-mcp-server'
		},
		{
			icon: Server,
			title: 'WireShark Integration',
			description:
				'Did you know you can capture network traffic from your cluster into WireShark using Inspektor Gadget? Click here to find out more!',
			color: 'purple',
			url: 'https://github.com/flyth/ig-extcap'
		},
		{
			icon: GridSmall,
			title: 'Headlamp Plugin',
			description:
				'Did you know you can also use Inspektor Gadget from within Headlamp, the Kubernetes UI? Click here to find out more!',
			color: 'green',
			url: 'https://github.com/inspektor-gadget/headlamp-plugin'
		}
	];

	// Select 3 random tips (or all if less than 3)
	let selectedTips = $state<typeof allTips>([]);

	$effect(() => {
		const shuffled = [...allTips].sort(() => Math.random() - 0.5);
		selectedTips = shuffled.slice(0, 3);
	});
</script>

<div class="flex flex-1 flex-col gap-8 overflow-auto bg-gray-950/80 p-8 text-gray-100">
	{#if !Object.keys(environments).length}
		<!-- Welcome state when no environments exist -->
		<div class="mx-auto w-full max-w-7xl">
			<!-- Hero Section -->
			<div class="mt-12 mb-12 flex flex-col items-center gap-6 text-center">
				<div class="flex flex-col gap-2">
					<h1
						class="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-6xl font-bold text-transparent"
					>
						Welcome!
					</h1>
					<p class="text-2xl text-gray-400">The Inspektor awaits you.</p>
				</div>
				<p class="max-w-2xl text-lg text-gray-500">
					Get started by setting up your first environment to begin exploring and debugging your
					systems with Inspektor Gadget's powerful eBPF-based tools.
				</p>
			</div>

			<!-- Get Started Panel -->
			<div class="mx-auto mb-16 max-w-3xl">
				<Panel title="Get Started" icon={CirclePlus} color="blue" bodyPadding="large">
					<div class="flex flex-col gap-6">
						<div class="flex flex-col gap-3">
							<h3 class="text-xl font-semibold text-gray-200">Create Your First Environment</h3>
							<p class="text-gray-400">
								Connect to a Kubernetes cluster or Linux host to start running gadgets. Use the
								button in the upper left or click below.
							</p>
						</div>

						<a
							href="/environment/create"
							class="group/btn flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-all hover:bg-blue-500"
						>
							<div class="h-5 w-5">{@html CirclePlus}</div>
							<span>Create New Environment</span>
						</a>

						<div class="flex flex-col gap-2 border-t border-gray-800 pt-4">
							<p class="text-sm text-gray-400">Haven't installed Inspektor Gadget yet?</p>
							<p class="text-sm text-gray-500">
								For Kubernetes, you can use a 1-click installation directly from IG Desktop. Just
								follow the step above and create a new environment.
							</p>
							<p class="text-sm text-gray-500">
								Otherwise, check out the
								<button
									onclick={() =>
										Browser.OpenURL('https://inspektor-gadget.io/docs/latest/quick-start')}
									class="text-blue-400 underline hover:text-blue-300"
								>
									Quickstart Guide
								</button>
								to deploy Inspektor Gadget to your
								<button
									onclick={() =>
										Browser.OpenURL(
											'https://inspektor-gadget.io/docs/latest/quick-start#kubernetes'
										)}
									class="text-blue-400 underline hover:text-blue-300"
								>
									Kubernetes cluster
								</button>
								or run it as a
								<button
									onclick={() =>
										Browser.OpenURL('https://inspektor-gadget.io/docs/latest/quick-start#linux')}
									class="text-blue-400 underline hover:text-blue-300"
								>
									daemon on your Linux machine
								</button>.
							</p>
						</div>
					</div>
				</Panel>
			</div>
		</div>
	{:else}
		<!-- Main content when environments exist -->
		<div class="mx-auto flex w-full max-w-7xl flex-col gap-12">
			<!-- Hero Section -->
			<div class="mt-12 flex flex-col gap-4">
				<h1
					class="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-5xl font-bold text-transparent"
				>
					Ready to explore?
				</h1>
				<p class="text-xl text-gray-400">
					Your environments are set up. Choose where to start your investigation.
				</p>
			</div>

			<!-- Action Panels Grid -->
			<div class="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
				<!-- Environments Panel -->
				<Panel
					title="Environments"
					icon={Server}
					color="blue"
					badge={Object.keys(environments).length}
				>
					<p class="mb-2 text-sm text-gray-400">Select an environment to manage and run gadgets</p>
					<div class="flex flex-col gap-2">
						{#each Object.values(environments).slice(0, 4) as env}
							<button
								onclick={() => goto(`/env/${env.id}`)}
								class="group/item flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-blue-500/50 hover:bg-gray-900"
							>
								<div class="flex flex-col gap-1">
									<div class="font-medium text-gray-200">{env.name}</div>
									<div class="text-xs text-gray-400">{env.runtime}</div>
								</div>
								<div
									class="text-gray-600 transition-all group-hover/item:translate-x-1 group-hover/item:text-blue-400"
								>
									{@html ChevronRight}
								</div>
							</button>
						{/each}
					</div>
					{#if Object.keys(environments).length > 4}
						<div class="mt-2 text-center text-xs text-gray-500">
							+{Object.keys(environments).length - 4} more
						</div>
					{/if}
				</Panel>

				<!-- Recent Gadgets Panel -->
				<Panel title="Recent Activity" icon={History} color="purple">
					{#if allHistories.length > 0}
						<p class="mb-2 text-sm text-gray-400">Quick access to recently run gadgets</p>
						<div class="flex flex-col gap-2">
							{#each allHistories as { gadget, envId, envName }}
								<button
									onclick={() => runGadget(gadget, envId)}
									class="group/item flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-purple-500/50 hover:bg-gray-900"
								>
									<div class="flex flex-1 flex-col gap-1 overflow-hidden">
										<div class="truncate font-medium text-gray-200">
											{getGadgetName(gadget.image)}
										</div>
										<div class="flex items-center gap-2 text-xs">
											<span class="text-gray-400">{envName}</span>
											{#if gadget.timestamp}
												<span class="text-gray-500">•</span>
												<span class="text-gray-500">{formatRelativeTime(gadget.timestamp)}</span>
											{/if}
										</div>
									</div>
									<div
										class="text-gray-600 transition-all group-hover/item:translate-x-1 group-hover/item:text-purple-400"
									>
										{@html ChevronRight}
									</div>
								</button>
							{/each}
						</div>
					{:else}
						<div class="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
							<div class="text-gray-600">{@html History}</div>
							<p class="text-sm text-gray-500">No gadgets run yet</p>
							<p class="text-xs text-gray-600">Your recent activity will appear here</p>
						</div>
					{/if}
				</Panel>

				<!-- Discover Gadgets Panel -->
				<Panel title="Discover Gadgets" icon={Grid} color="green">
					<p class="mb-2 text-sm text-gray-400">Explore the Artifact Hub gadget gallery</p>

					<!-- Featured categories -->
					<div class="flex flex-col gap-2">
						<a
							href="/browse/artifacthub"
							class="group/item flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 transition-all hover:border-green-500/50 hover:bg-gray-900"
						>
							<div class="flex flex-col gap-1">
								<div class="font-medium text-gray-200">All Gadgets</div>
								<div class="text-xs text-gray-400">Browse complete collection</div>
							</div>
							<div
								class="text-gray-600 transition-all group-hover/item:translate-x-1 group-hover/item:text-green-400"
							>
								{@html ChevronRight}
							</div>
						</a>

						<a
							href="/browse/artifacthub"
							class="group/item flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 transition-all hover:border-green-500/50 hover:bg-gray-900"
						>
							<div class="flex flex-col gap-1">
								<div class="font-medium text-gray-200">Security</div>
								<div class="text-xs text-gray-400">Security monitoring gadgets</div>
							</div>
							<div
								class="text-gray-600 transition-all group-hover/item:translate-x-1 group-hover/item:text-green-400"
							>
								{@html ChevronRight}
							</div>
						</a>

						<a
							href="/browse/artifacthub"
							class="group/item flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 transition-all hover:border-green-500/50 hover:bg-gray-900"
						>
							<div class="flex flex-col gap-1">
								<div class="font-medium text-gray-200">Networking</div>
								<div class="text-xs text-gray-400">Network analysis tools</div>
							</div>
							<div
								class="text-gray-600 transition-all group-hover/item:translate-x-1 group-hover/item:text-green-400"
							>
								{@html ChevronRight}
							</div>
						</a>
					</div>

					<!-- Artifact Hub branding -->
					<div class="mt-auto flex items-center gap-2 pt-4 text-xs text-gray-600">
						<div class="h-4 w-4">{@html ArtifactHub}</div>
						<span>Powered by Artifact Hub</span>
					</div>
				</Panel>
			</div>

			<!-- Quick Tips -->
			<div
				class="rounded-xl border border-gray-800 bg-gray-900/30 p-6 shadow-sm shadow-gray-950/90"
			>
				<h3 class="mb-4 text-sm font-semibold tracking-wide text-gray-400 uppercase">
					Did You Know?
				</h3>
				<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
					{#each selectedTips as tip}
						<button
							onclick={() => {
								Browser.OpenURL(tip.url);
							}}
							class="group/tip flex gap-2 rounded-lg border border-transparent bg-gray-800 p-4 text-left shadow-sm shadow-gray-950/90 transition-all hover:border-gray-700 hover:bg-gray-900/50"
						>
							<div class="text-{tip.color}-400">{@html tip.icon}</div>
							<div>
								<div class="mb-1 text-sm font-medium text-gray-300">{tip.title}</div>
								<div class="text-xs text-gray-400">{tip.description}</div>
							</div>
						</button>
					{/each}
				</div>
			</div>

			{@render Resources()}
		</div>
	{/if}
</div>

{#snippet Resources()}
	<!-- Resources & Community Panel -->
	<div class="mx-auto max-w-7xl">
		<Panel title="Resources & Community" icon={Book} color="purple" bodyPadding="large">
			<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
				<!-- Documentation Section -->
				<div class="flex flex-col gap-3">
					<h3
						class="flex items-center gap-2 text-sm font-semibold tracking-wide text-gray-400 uppercase"
					>
						<div class="h-4 w-4">{@html BookSmall}</div>
						Documentation
					</h3>
					<div class="flex flex-col gap-2">
						<button
							onclick={() => Browser.OpenURL('https://inspektor-gadget.io/')}
							class="group/link flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-purple-500/50 hover:bg-gray-900"
						>
							<div class="flex items-center gap-3">
								<div class="text-purple-400">{@html Link}</div>
								<span class="text-gray-200">Website</span>
							</div>
							<div
								class="text-gray-600 transition-all group-hover/link:translate-x-1 group-hover/link:text-purple-400"
							>
								{@html ChevronRight}
							</div>
						</button>

						<button
							onclick={() => Browser.OpenURL('https://inspektor-gadget.io/blog')}
							class="group/link flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-purple-500/50 hover:bg-gray-900"
						>
							<div class="flex items-center gap-3">
								<div class="text-purple-400">{@html Link}</div>
								<span class="text-gray-200">Blog</span>
							</div>
							<div
								class="text-gray-600 transition-all group-hover/link:translate-x-1 group-hover/link:text-purple-400"
							>
								{@html ChevronRight}
							</div>
						</button>

						<button
							onclick={() => Browser.OpenURL('https://inspektor-gadget.io/docs/latest/quick-start')}
							class="group/link flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-purple-500/50 hover:bg-gray-900"
						>
							<div class="flex items-center gap-3">
								<div class="text-purple-400">{@html Book}</div>
								<span class="text-gray-200">Quickstart Guide</span>
							</div>
							<div
								class="text-gray-600 transition-all group-hover/link:translate-x-1 group-hover/link:text-purple-400"
							>
								{@html ChevronRight}
							</div>
						</button>

						<button
							onclick={() =>
								Browser.OpenURL('https://inspektor-gadget.io/docs/latest/gadget-devel/')}
							class="group/link flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-purple-500/50 hover:bg-gray-900"
						>
							<div class="flex items-center gap-3">
								<div class="text-purple-400">{@html Book}</div>
								<span class="text-gray-200">Gadget Development Guide</span>
							</div>
							<div
								class="text-gray-600 transition-all group-hover/link:translate-x-1 group-hover/link:text-purple-400"
							>
								{@html ChevronRight}
							</div>
						</button>
					</div>
				</div>

				<!-- Community Section -->
				<div class="flex flex-col gap-3">
					<h3
						class="flex items-center gap-2 text-sm font-semibold tracking-wide text-gray-400 uppercase"
					>
						<div class="h-4 w-4">{@html GridSmall}</div>
						Community
					</h3>
					<div class="flex flex-col gap-2">
						<button
							onclick={() => Browser.OpenURL('https://discord.gg/HbapduTjj9')}
							class="group/link flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-purple-500/50 hover:bg-gray-900"
						>
							<div class="flex items-center gap-3">
								<div class="text-purple-400">{@html GridSmall}</div>
								<div class="flex flex-col">
									<span class="text-gray-200">Discord</span>
									<span class="text-xs text-gray-500">Join our Discord community</span>
								</div>
							</div>
							<div
								class="text-gray-600 transition-all group-hover/link:translate-x-1 group-hover/link:text-purple-400"
							>
								{@html ChevronRight}
							</div>
						</button>

						<button
							onclick={() => Browser.OpenURL('https://kubernetes.slack.com/archives/CSYL75LF6')}
							class="group/link flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-purple-500/50 hover:bg-gray-900"
						>
							<div class="flex items-center gap-3">
								<div class="text-purple-400">{@html GridSmall}</div>
								<div class="flex flex-col">
									<span class="text-gray-200">Slack</span>
									<span class="text-xs text-gray-500">Connect on Slack</span>
								</div>
							</div>
							<div
								class="text-gray-600 transition-all group-hover/link:translate-x-1 group-hover/link:text-purple-400"
							>
								{@html ChevronRight}
							</div>
						</button>
					</div>

					<div class="rounded-lg border border-gray-800 bg-gray-900/30 p-4">
						<p class="text-sm text-gray-400">
							Have questions or want to contribute? Join our community to connect with other users
							and the Inspektor Gadget team.
						</p>
					</div>
				</div>
			</div>
		</Panel>
	</div>
{/snippet}
