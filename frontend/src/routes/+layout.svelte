<script lang="ts">
	import '../app.css';
	import { setContext, onMount } from 'svelte';

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
	import UpdateCheckModal from '$lib/components/UpdateCheckModal.svelte';
	import AnalyticsOptInModal from '$lib/components/AnalyticsOptInModal.svelte';
	import VersionInfoModal from '$lib/components/VersionInfoModal.svelte';
	import { analyticsService } from '$lib/services/analytics.service.svelte';
	import { themeService } from '$lib/services/theme.service.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import { appState } from './state.svelte.js';
	import { environments } from '$lib/shared/environments.svelte.js';
	import { deployments } from '$lib/shared/deployments.svelte';
	import Server from '$lib/icons/server.svg?raw';
	import { websocketService } from '$lib/services/websocket.service.svelte';
	import { apiService } from '$lib/services/api.service.svelte';
	import { messageRouter } from '$lib/services/message-router.service.svelte';
	import { currentEnvironment } from '$lib/shared/current-environment.svelte';
	import { configuration } from '$lib/stores/configuration.svelte';
	import { settingsDialog } from '$lib/stores/settings-dialog.svelte';
	import { environment } from '$lib/services/environment.service.svelte';
	import Lock from '$lib/icons/fa/lock.svg?raw';
	import LockOpen from '$lib/icons/fa/lock-open.svg?raw';
	import Cog from '$lib/icons/cog.svg?raw';
	import { APP_MODE, features } from '$lib/config/app-mode';
	import { loadSingleEnvConfig } from '$lib/services/config-loader.service';
	import { resolve } from '$app/paths';
	import { registerBuiltinPlugins } from '$lib/plugins/builtin';
	import { loadLocalPlugins } from '$lib/services/plugin-loader.service';
	import PluginHookRenderer from '$lib/components/PluginHookRenderer.svelte';

	let { children } = $props();

	// Deployment modal state
	let deployModalOpen = $state(false);
	let activeDeploymentId: string | undefined = $state(undefined);

	// Configuration modal state - use settingsDialog store for deep-linking support
	let configModalOpen = $derived(settingsDialog.open);

	// Update check modal state (for opt-in on second start)
	let updateCheckModalOpen = $state(false);

	// Analytics opt-in modal state (for opt-in on third start)
	let analyticsOptInModalOpen = $state(false);

	// Version info modal state
	let versionInfoModalOpen = $state(false);

	let version = $state('unknown');

	// Update check state
	let updateInfo = $state({
		checking: false,
		updateAvailable: false,
		latestVersion: '',
		releasesUrl: 'https://github.com/inspektor-gadget/ig-desktop/releases'
	});

	// Start count tracking for opt-in modals
	const START_COUNT_KEY = 'ig-start-count';
	const UPDATE_OPT_IN_SHOWN_KEY = 'ig-update-opt-in-shown';
	const ANALYTICS_OPT_IN_SHOWN_KEY = 'ig-analytics-opt-in-shown';

	// Check for updates
	function checkForUpdates() {
		updateInfo.checking = true;
		apiService
			.request({ cmd: 'checkForUpdates' })
			.then((data) => {
				if (data) {
					updateInfo.updateAvailable = data.updateAvailable || false;
					updateInfo.latestVersion = data.latestVersion || '';
					updateInfo.releasesUrl = data.releasesUrl || updateInfo.releasesUrl;
				}
			})
			.catch((err) => {
				console.error('Failed to check for updates:', err);
			})
			.finally(() => {
				updateInfo.checking = false;
			});
	}

	// Track start count and show opt-in modals
	function handleStartCount() {
		if (typeof window === 'undefined') return;

		const startCount = parseInt(localStorage.getItem(START_COUNT_KEY) || '0', 10) + 1;
		localStorage.setItem(START_COUNT_KEY, String(startCount));

		const updateOptInShown = localStorage.getItem(UPDATE_OPT_IN_SHOWN_KEY) === 'true';
		const analyticsOptInShown = localStorage.getItem(ANALYTICS_OPT_IN_SHOWN_KEY) === 'true';

		// Show update opt-in modal on second start if not already shown
		if (startCount >= 2 && !updateOptInShown) {
			localStorage.setItem(UPDATE_OPT_IN_SHOWN_KEY, 'true');
			// Delay slightly to let the app initialize
			setTimeout(() => {
				updateCheckModalOpen = true;
			}, 500);
		}

		// Show analytics opt-in modal on third start if not already shown
		if (startCount >= 3 && updateOptInShown && !analyticsOptInShown) {
			localStorage.setItem(ANALYTICS_OPT_IN_SHOWN_KEY, 'true');
			// Delay slightly to let the app initialize
			setTimeout(() => {
				analyticsOptInModalOpen = true;
			}, 500);
		}

		// Check for updates if enabled
		const checkForUpdatesEnabled = configuration.get('checkForUpdates');
		if (checkForUpdatesEnabled) {
			checkForUpdates();
		}

		// Initialize analytics if user has opted in
		analyticsService.initialize();
	}

	// Fetch version and load plugins when connected
	$effect(() => {
		if (websocketService.connected) {
			apiService
				.request({ cmd: 'getVersion' })
				.then((data) => {
					if (data?.version) {
						version = data.version;
					}
				})
				.catch((err) => {
					console.error('Failed to fetch version:', err);
				});

			// Handle start count and update checks
			handleStartCount();

			// Load local plugins from backend
			loadLocalPlugins();
		}
	});

	// Get gradient setting from configuration store
	let gradientEnabled = $derived(configuration.get('gradientEnabled') !== false);

	// Apply theme changes reactively
	$effect(() => {
		themeService.applyTheme();
	});

	let modalError: string | null = $state(null);

	function handleError(err: unknown) {
		// Extract meaningful error message from various error types
		let message;

		if (err instanceof ErrorEvent) {
			// From window.onerror - extract the message
			message = err.message || 'Unknown error';
		} else if (err instanceof Error) {
			message = err.message;
		} else if (typeof err === 'string') {
			message = err;
		} else if (err && typeof err === 'object' && 'message' in err) {
			message = String(err.message);
		} else {
			message = String(err);
		}

		// Filter out Wails initialization race condition errors (not actionable)
		if (message.includes('dispatchWailsEvent is not a function')) {
			console.warn('Wails initialization race condition (can be ignored):', message);
			return;
		}

		modalError = message;
	}

	// Initialize WebSocket and message routing on mount (after Wails globals are ready)
	onMount(async () => {
		// Register built-in plugins before anything else
		registerBuiltinPlugins();

		const isWailsApp = environment.isApp;
		console.log('Environment detected:', isWailsApp ? 'wails' : 'browser');
		console.log('App mode:', APP_MODE);

		// Handle single-env mode: load environment from config before connecting
		if (APP_MODE === 'single-env') {
			const config = await loadSingleEnvConfig();
			if (config?.environment) {
				// Pre-populate the environment so it's available immediately
				environments[config.environment.id] = config.environment;
				console.log('Single-env mode: loaded environment', config.environment.name);
			}
		}

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
	});

	// Provide API context for child components
	setContext('api', {
		request(cmd: { cmd: string; data?: unknown }) {
			return apiService.request(cmd);
		},
		listSessions(environmentId: string) {
			return apiService.listSessions(environmentId);
		},
		deleteSession(sessionId: string) {
			return apiService.deleteSession(sessionId);
		},
		getSession(sessionId: string) {
			return apiService.getSession(sessionId);
		},
		getRun(sessionId: string, runId: string) {
			return apiService.getRun(sessionId, runId);
		},
		getRunEvents(sessionId: string, runId: string) {
			return apiService.getRunEvents(sessionId, runId);
		}
	});

	let isMaximized = $state(false);
	async function toggleMaximize() {
		const { Window } = await import('@wailsio/runtime');
		if (isMaximized) {
			isMaximized = false;
			Window.ToggleMaximise();
		} else {
			isMaximized = true;
			Window.Maximise();
		}
	}

	async function minimize() {
		const { Window } = await import('@wailsio/runtime');
		await Window.Minimise();
	}

	async function quitApp() {
		const { Application } = await import('@wailsio/runtime');
		Application.Quit();
	}

	window.onunhandledrejection = (err) => {
		handleError(err.reason);
	};
</script>

<svelte:window onerror={handleError} />
<div class="flex h-screen flex-col" class:bg-gradient-overlay={gradientEnabled}>
	{#if environment.hasWindowControls}
		{#if environment.isMac}
			<!-- macOS-style title bar - native traffic lights are provided by the OS -->
			<div
				role="banner"
				ondblclick={() => {
					toggleMaximize();
				}}
				style="--wails-draggable: drag"
				class="relative flex flex-row items-center border-b border-b-gray-200 bg-white/80 dark:border-b-gray-800 dark:bg-gray-950/80 backdrop-blur-sm select-none"
			>
				<!-- Spacer for native traffic light buttons (approx 78px) -->
				<div class="w-20 shrink-0"></div>
				<!-- Centered title -->
				<div class="flex-1 flex items-center justify-center py-2">
					<div
						class="flex flex-row items-center gap-2 text-xs text-gray-500 dark:text-gray-400 uppercase"
					>
						<div class="flex">{@html BrandIcon}</div>
						<div class="leading-none pt-px">Inspektor Gadget Desktop</div>
					</div>
				</div>
				<!-- Right spacer for balance -->
				<div class="w-20 shrink-0"></div>
			</div>
		{:else}
			<!-- Windows/Linux-style title bar with buttons on the right -->
			<div
				role="banner"
				ondblclick={() => {
					toggleMaximize();
				}}
				style="--wails-draggable: drag"
				class="flex flex-row items-center justify-between border-b border-b-gray-200 bg-white/80 dark:border-b-gray-800 dark:bg-gray-950/80 backdrop-blur-sm select-none"
			>
				<div
					class="flex flex-row items-center gap-2 px-2 py-2 text-xs text-gray-500 dark:text-gray-600 uppercase"
				>
					<div>{@html BrandIcon}</div>
					<div>Inspektor Gadget Desktop</div>
				</div>
				<div
					style="--wails-draggable: no-drag"
					class="flex flex-row gap-2 px-2 py-1 text-gray-500 dark:text-gray-600"
				>
					<button
						type="button"
						class="hover:text-gray-900 dark:hover:text-white"
						onclick={() => {
							minimize();
						}}
						aria-label="Minimize window"
					>
						{@html Minimize}
					</button>
					<button
						type="button"
						class="hover:text-gray-900 dark:hover:text-white"
						onclick={() => {
							toggleMaximize();
						}}
						aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
					>
						{#if isMaximized}{@html Restore}{:else}{@html Maximize}{/if}
					</button>
					<button
						type="button"
						class="hover:text-gray-900 dark:hover:text-white"
						onclick={() => {
							quitApp();
						}}
						aria-label="Close window"
					>
						{@html Close}
					</button>
				</div>
			</div>
		{/if}
	{/if}
	{#if websocketService.connected}
		<div class="flex flex-1 overflow-hidden text-gray-900 dark:text-gray-100">
			<div
				class="scrollbar-hide flex flex-col justify-between space-y-2 overflow-y-scroll border-r border-r-gray-200 bg-gray-100/60 dark:border-r-gray-700 dark:bg-gray-900/60 p-3 backdrop-blur-md"
			>
				<div class="flex flex-col select-none">
					{#if features.isSingleEnvironment}
						<!-- Single-env mode: show Home button that links to the single environment -->
						{#each Object.entries(environments) as [id, env]}
							<NavbarLink href={resolve(`/env/${id}`)} title="Home">
								{@html BrandIconLarge}
							</NavbarLink>
						{/each}
					{:else}
						<!-- Full mode: show brand logo linking to home page -->
						<NavbarLink href={resolve('/')} title="Home">{@html BrandIconLarge}</NavbarLink>
						{#each Object.entries(environments) as [id, env]}
							<NavbarLink href={resolve(`/env/${id}`)} title={env.name}>
								<div class="grid" title={env.name}>
									<div class="col-start-1 row-start-1 text-gray-200 dark:text-gray-600 opacity-80">
										{@html Gadget}
									</div>
									<div class="z-10 col-start-1 row-start-1 flex justify-center text-lg shadow">
										{env.name.substring(0, 3)}
									</div>
								</div>
							</NavbarLink>
						{/each}
						<!--					<NavbarLink href="/k">{@html Kubernetes}</NavbarLink>-->
						{#if features.canCreateEnvironment}
							<NavbarLink href={resolve('/environment/create')} title="Create environment"
								>{@html Plus}</NavbarLink
							>
						{/if}
					{/if}
				</div>
				<div class="flex grow flex-col">
					<!-- Plugin sidebar hooks -->
					<PluginHookRenderer hookId="sidebar:navigation" scopes={['local', 'builtin']} />
				</div>
				<div class="flex flex-col">
					{#if features.canBrowseArtifactHub}
						<NavbarLink href={resolve('/browse/artifacthub')}>{@html ArtifactHub}</NavbarLink>
					{/if}
					<NavbarLink
						href="https://inspektor-gadget.io/docs/latest/"
						target="_blank"
						title="Documentation (external)">{@html Book}</NavbarLink
					>
					<NavbarLink
						onclick={() => {
							settingsDialog.open = true;
						}}
						title="Settings"
					>
						{@html Cog}
					</NavbarLink>
					<NavbarLink href={resolve('/info')}>{@html Info}</NavbarLink>
				</div>
			</div>
			{@render children()}
		</div>
		<div
			class="flex flex-row justify-between gap-2 border-t border-t-gray-200 bg-gray-100/70 dark:border-t-gray-700 dark:bg-gray-900/70 p-1 px-2 text-xs text-gray-500 backdrop-blur-md"
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
			</div>
			<div class="flex items-center gap-2">
				{#if updateInfo.updateAvailable}
					<button
						onclick={() => {
							versionInfoModalOpen = true;
						}}
						class="text-blue-400 hover:text-blue-300"
						title="Click for version details"
					>
						Update available: {updateInfo.latestVersion} (current: {version})
					</button>
				{:else}
					<button
						onclick={() => {
							versionInfoModalOpen = true;
						}}
						class="hover:text-gray-700 dark:hover:text-gray-300"
						title="Click for version details"
					>
						Version {version}
					</button>
				{/if}
			</div>
		</div>
	{:else}
		<div
			class="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950 align-middle font-mono text-gray-900 dark:text-gray-100"
		>
			Calling the Inspektor...
		</div>
		<div
			class="border-t border-t-gray-200 bg-gray-100/70 dark:border-t-gray-700 dark:bg-gray-900/70 p-1 pl-2 text-xs text-gray-500 backdrop-blur-md"
		>
			Disconnected
		</div>
	{/if}
</div>
{#if modalError}
	<div
		class="fixed top-0 left-0 z-100 flex h-full w-full flex-row justify-between bg-gray-100/90 dark:bg-gray-900/90 text-gray-900 dark:text-white"
	>
		<div></div>
		<div class="flex max-w-1/3 flex-col justify-between">
			<div></div>
			<div
				class="flex flex-col gap-8 rounded-xl border border-gray-300 bg-white/90 dark:border-gray-700 dark:bg-gray-900/90 p-16 backdrop-blur-lg"
			>
				<div class="text-lg text-gray-600 dark:text-gray-400">An error occurred</div>
				<div class="text-red-600 dark:text-red-400">{modalError}</div>
				<div class="flex flex-row justify-end">
					<button
						onclick={() => {
							modalError = null;
						}}
						class="flex cursor-pointer flex-row items-center gap-2 rounded bg-red-600 dark:bg-red-900 px-2 py-1 text-white hover:bg-red-500 dark:hover:bg-red-800"
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
	{@const activeDeployment = deployments.getActive()!}
	<button
		onclick={() => {
			activeDeploymentId = activeDeployment.id;
			deployModalOpen = true;
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

<!-- Update Check Opt-in Modal -->
<UpdateCheckModal
	bind:open={updateCheckModalOpen}
	onClose={() => {
		updateCheckModalOpen = false;
		// If they enabled it, check for updates now
		if (configuration.get('checkForUpdates')) {
			checkForUpdates();
		}
	}}
/>

<!-- Analytics Opt-in Modal -->
<AnalyticsOptInModal
	bind:open={analyticsOptInModalOpen}
	onClose={() => {
		analyticsOptInModalOpen = false;
	}}
/>

<!-- Version Info Modal -->
<VersionInfoModal
	bind:open={versionInfoModalOpen}
	onClose={() => {
		versionInfoModalOpen = false;
	}}
/>

<!-- Global Configuration Modal -->
<ConfigurationModal
	bind:open={settingsDialog.open}
	onClose={() => {
		settingsDialog.close();
	}}
/>

<!-- Global Toast Container -->
<ToastContainer hasDeploymentIndicator={!!deployments.getActive()} />
