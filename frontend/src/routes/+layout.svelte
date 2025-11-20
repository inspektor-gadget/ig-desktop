<script lang="js">
	import '../app.css';
	import { Application, Window } from '@wailsio/runtime';
	import { setContext } from 'svelte';

	import Logo from '$lib/components/Logo.svelte';
	import BrandIcon from '$lib/icons/ig/small.svg?raw';
	import BrandIconLarge from '$lib/icons/ig/large.svg?raw';
	import Gadget from '$lib/icons/gadget.svg?raw';
	import Plus from '$lib/icons/circle-plus.svg?raw';
	import Info from '$lib/icons/info.svg?raw';
	import Book from '$lib/icons/book.svg?raw';
	import Close from '$lib/icons/close-small.svg?raw';
	import Maximize from '$lib/icons/fa/window-maximize.svg?raw';
	import Minimize from '$lib/icons/fa/window-minimize.svg?raw';
	import Restore from '$lib/icons/fa/window-restore.svg?raw';
	import ArtifactHub from '$lib/icons/artifacthub-logo.svg?raw';
	import NavbarLink from '$lib/components/NavbarLink.svelte';
	import K8sDeployModal from '$lib/components/K8sDeployModal.svelte';
	import ConfirmationModal from '$lib/components/ConfirmationModal.svelte';
	import ConfigurationModal from '$lib/components/ConfigurationModal.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import { appState } from './state.svelte.js';
	import { environments } from '$lib/shared/environments.svelte.js';
	import { deployments } from '$lib/shared/deployments.svelte';
	import Server from '$lib/icons/server.svg?raw';
	import { websocketService } from '$lib/services/websocket.service.svelte';
	import { apiService } from '$lib/services/api.service.svelte';
	import { messageRouter } from '$lib/services/message-router.service.svelte';
	import { currentEnvironment } from '$lib/shared/current-environment.svelte';
	import Lock from '$lib/icons/fa/lock.svg?raw';
	import LockOpen from '$lib/icons/fa/lock-open.svg?raw';
	import Cog from '$lib/icons/cog-small.svg?raw';

	let { children } = $props();

	// Deployment modal state
	let deployModalOpen = $state(false);
	let activeDeploymentId = $state(undefined);

	// Configuration modal state
	let configModalOpen = $state(false);

	let version = $state('unknown');

	// Toggle for gradient background - persist to localStorage
	let gradientEnabled = $state(
		typeof window !== 'undefined' ? localStorage.getItem('gradientEnabled') !== 'false' : true
	);

	// Save preference when it changes
	$effect(() => {
		if (typeof window !== 'undefined') {
			localStorage.setItem('gradientEnabled', String(gradientEnabled));
		}
	});

	let modalError = $state(null);
	function handleError(err) {
		modalError = err;
	}

	// Initialize WebSocket and message routing
	const isWailsApp = true; // Could be dynamic based on environment detection
	websocketService.initialize(isWailsApp, (message) => {
		messageRouter.route(message);
	});

	// Set up legacy appState.api for browser mode compatibility
	if (!isWailsApp) {
		const ws = websocketService.getWebSocket();
		if (ws) {
			appState.api.setWs(ws);
		}
	}

	// Provide API context for child components
	setContext('api', {
		request(cmd) {
			return apiService.request(cmd);
		}
	});

	let isMaximized = $state(false);
	async function toggleMaximize() {
		if (isMaximized) {
			isMaximized = false;
			Window.ToggleMaximise();
		} else {
			isMaximized = true;
			Window.Maximise();
		}
	}

	window.onunhandledrejection = (err) => {
		handleError(err.reason);
	};
</script>

<svelte:window onerror={handleError} />
<div class="flex h-screen flex-col" class:bg-gradient-overlay={gradientEnabled}>
	{#if websocketService.isApp}
		<div
			role="banner"
			ondblclick={() => {
				toggleMaximize();
			}}
			style="--wails-draggable: drag"
			class="flex flex-row items-center justify-between border-b border-b-gray-800 bg-gray-950/80 backdrop-blur-sm select-none"
		>
			<div class="flex flex-row gap-2 px-2 py-2 text-xs text-gray-600 uppercase">
				<div>{@html BrandIcon}</div>
				<div>Inspektor Gadget Desktop</div>
			</div>
			<div style="--wails-draggable: no-drag" class="flex flex-row gap-2 px-2 py-1 text-gray-600">
				<button
					type="button"
					class="hover:text-white"
					onclick={() => {
						window.runtime.WindowMinimise();
					}}
					aria-label="Minimize window"
				>
					{@html Minimize}
				</button>
				<button
					type="button"
					class="hover:text-white"
					onclick={() => {
						toggleMaximize();
					}}
					aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
				>
					{#if isMaximized}{@html Restore}{:else}{@html Maximize}{/if}
				</button>
				<button
					type="button"
					class="hover:text-white"
					onclick={() => {
						Application.Quit();
					}}
					aria-label="Close window"
				>
					{@html Close}
				</button>
			</div>
		</div>
	{/if}
	{#if websocketService.connected}
		<div class="flex flex-1 overflow-hidden text-gray-100">
			<div
				class="scrollbar-hide flex flex-col justify-between space-y-2 overflow-y-scroll border-r border-r-gray-700 bg-gray-900/60 p-3 backdrop-blur-md"
			>
				<div class="flex flex-col select-none">
					{#if !websocketService.isApp}
						<a href="https://inspektor-gadget.io" target="_blank">
							<Logo />
						</a>
						<hr class="mx-2 my-4 rounded border-t-2 border-t-white/[.3]" />
					{/if}
					<NavbarLink href="/" title="Home">{@html BrandIconLarge}</NavbarLink>
					{#each Object.entries(environments) as [id, environment]}
						<NavbarLink href="/env/{id}" title={environment.name}>
							<div class="grid" title={environment.name}>
								<div class="col-start-1 row-start-1 text-gray-600 opacity-80">{@html Gadget}</div>
								<div class="z-10 col-start-1 row-start-1 flex justify-center text-lg shadow">
									{environment.name.substring(0, 3)}
								</div>
							</div>
						</NavbarLink>
					{/each}
					<!--					<NavbarLink href="/k">{@html Kubernetes}</NavbarLink>-->
					<NavbarLink href="/environment/create" title="Create environment">{@html Plus}</NavbarLink
					>
				</div>
				<div class="flex grow flex-col"></div>
				<div class="flex flex-col">
					<NavbarLink href="/browse/artifacthub">{@html ArtifactHub}</NavbarLink>
					<NavbarLink href="https://inspektor-gadget.io/docs/latest/" target="_blank"
						>{@html Book}</NavbarLink
					>
					<NavbarLink href="/info">{@html Info}</NavbarLink>
				</div>
			</div>
			{@render children()}
		</div>
		<div
			class="flex flex-row justify-between gap-2 border-t border-t-gray-700 bg-gray-900/70 p-1 px-2 text-xs text-gray-500 backdrop-blur-md"
		>
			<div class="flex items-center gap-4">
				<div class="flex items-center gap-1.5">
					{#if currentEnvironment.environment}
						{#if currentEnvironment.hasTLS()}
							<span class="text-gray-500" title="Secure Connection">{@html Lock}</span>
						{:else}
							<span class="text-red-400" title="Insecure Connection">{@html LockOpen}</span>
						{/if}
					{/if}
					<span
						class:text-gray-500={currentEnvironment.connectionStatus !== 'error'}
						class:text-red-500={currentEnvironment.connectionStatus === 'error'}
					>
						{currentEnvironment.getStatusText()}
					</span>
				</div>
				<button
					onclick={() => {
						gradientEnabled = !gradientEnabled;
					}}
					class="flex items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-gray-800 hover:text-gray-300"
					title="Toggle gradient background"
				>
					<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
						></path>
					</svg>
					<span>{gradientEnabled ? 'Gradient On' : 'Gradient Off'}</span>
				</button>
			</div>
			<div class="flex items-center gap-2">
				<span>Version {version}</span>
				<button
					onclick={() => {
						configModalOpen = true;
					}}
					class="flex items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-gray-800 hover:text-gray-300"
					title="Configuration"
					aria-label="Open configuration"
				>
					{@html Cog}
				</button>
			</div>
		</div>
	{:else}
		<div
			class="flex flex-1 items-center justify-center bg-gray-950 align-middle font-mono text-gray-100"
		>
			Calling the Inspektor...
		</div>
		<div
			class="border-t border-t-gray-700 bg-gray-900/70 p-1 pl-2 text-xs text-gray-500 backdrop-blur-md"
		>
			Disconnected
		</div>
	{/if}
</div>
{#if modalError}
	<div
		class="fixed top-0 left-0 z-100 flex h-full w-full flex-row justify-between bg-gray-900/90 text-white"
	>
		<div></div>
		<div class="flex max-w-1/3 flex-col justify-between">
			<div></div>
			<div
				class="flex flex-col gap-8 rounded-xl border border-gray-700 bg-gray-900/90 p-16 backdrop-blur-lg"
			>
				<div class="text-lg text-gray-400">An error occurred</div>
				<div>{JSON.stringify(modalError)}</div>
				<div class="flex flex-row justify-end">
					<button
						onclick={() => {
							modalError = null;
						}}
						class="flex cursor-pointer flex-row items-center gap-2 rounded bg-red-900 px-2 py-1 hover:bg-red-800"
						>Close
					</button>
				</div>
			</div>
			<div></div>
		</div>
		<div></div>
	</div>
{/if}

<!-- Global Deployment Indicator -->
{#if deployments.getActive()}
	{@const activeDeployment = deployments.getActive()}
	<button
		onclick={() => {
			if (activeDeployment) {
				activeDeploymentId = activeDeployment.id;
				deployModalOpen = true;
			}
		}}
		class="fixed right-4 bottom-4 z-40 flex items-center gap-3 rounded-lg border border-blue-800 bg-blue-900/90 px-4 py-3 text-white shadow-lg backdrop-blur-md transition-all hover:bg-blue-800/90"
		title="View deployment progress"
	>
		<div class="text-blue-400">{@html Server}</div>
		<div class="flex flex-col items-start gap-0.5">
			<div class="text-sm font-semibold">
				{activeDeployment.status === 'deploying' ? 'Deploying...' : 'Configuring...'}
			</div>
			{#if activeDeployment.status === 'deploying'}
				<div class="flex items-center gap-2">
					<div class="h-1 w-24 overflow-hidden rounded-full bg-blue-950">
						<div
							class="h-full bg-blue-400 transition-all duration-500"
							style="width: {activeDeployment.progress}%"
						></div>
					</div>
					<span class="text-xs text-blue-300">{activeDeployment.progress}%</span>
				</div>
			{/if}
		</div>
	</button>
{/if}

<!-- Global Deployment Modal -->
{#key activeDeploymentId}
	<K8sDeployModal
		bind:open={deployModalOpen}
		deploymentId={activeDeploymentId}
		onClose={() => {
			deployModalOpen = false;
			activeDeploymentId = undefined;
		}}
	/>
{/key}

<!-- Global Confirmation Modal -->
<ConfirmationModal />

<!-- Global Configuration Modal -->
<ConfigurationModal
	bind:open={configModalOpen}
	onClose={() => {
		configModalOpen = false;
	}}
/>

<!-- Global Toast Container -->
<ToastContainer hasDeploymentIndicator={!!deployments.getActive()} />
