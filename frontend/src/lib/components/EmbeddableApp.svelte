<script lang="ts">
	import { onMount, onDestroy, setContext, tick, untrack } from 'svelte';
	import { apiService } from '$lib/services/api.service.svelte';
	import { setPage } from '$lib/compat/app-state';
	import { setNavigationHandler } from '$lib/compat/app-navigation';
	import { base, resolve } from '$lib/compat/app-paths';
	import { embeddedRoute } from '$lib/utils/embedded-route';
	import type { EmbeddableAppProps, ResultViewChange } from '$lib/types/embedding';
	import { t } from '$lib/i18n/index.svelte';
	import EnvironmentList from './app/EnvironmentList.svelte';
	import EnvironmentCreate from './app/EnvironmentCreate.svelte';
	import EnvironmentDetail from './app/EnvironmentDetail.svelte';
	import EnvironmentLayout from './app/EnvironmentLayout.svelte';
	import ArtifactHubList from './app/ArtifactHubList.svelte';
	import ArtifactHubDetail from './app/ArtifactHubDetail.svelte';
	import GadgetLaunch from './app/GadgetLaunch.svelte';
	import SessionDetail from './app/SessionDetail.svelte';
	import Gadget from './Gadget.svelte';
	import NavbarLink from './NavbarLink.svelte';
	import ConfirmationModal from './ConfirmationModal.svelte';
	import ConfigurationModal from './ConfigurationModal.svelte';
	import ToastContainer from './ToastContainer.svelte';
	import { settingsDialog } from '$lib/stores/settings-dialog.svelte';
	import Server from '$lib/icons/server.svelte';
	import ArtifactHub from '$lib/icons/artifacthub-logo.svelte';
	import Plus from '$lib/icons/circle-plus.svelte';
	import { setFileOutputCapability } from '$lib/shared/file-output.svelte';

	let {
		path,
		homeTitle,
		onNavigate,
		viewState,
		onStateChange,
		sessions = true,
		showToasts = true,
		showNavigation = true,
		showTabs = true,
		launchPreset,
		fileOutput
	}: EmbeddableAppProps = $props();
	let route = $state(untrack(() => embeddedRoute(path ?? '/')));
	let result = $state<ResultViewChange | undefined>();
	const history: string[] = [];
	let revision = 0;

	setContext('api', apiService);
	setContext('sessionRecordingEnabled', () => sessions);
	setContext('fileOutput', () => fileOutput);
	setContext('navigateBack', () => navigate(history.pop() || '/', false));
	updatePage();

	$effect(() => setFileOutputCapability(fileOutput));
	onDestroy(() => setFileOutputCapability(undefined));

	function updatePage() {
		const { pathname, search, hash } = route.url;
		setPage({
			params: route.params,
			url: new URL(resolve(pathname + search + hash), 'http://localhost')
		});
	}

	function navigate(next: string, remember = true) {
		const nextRoute = embeddedRoute(next);
		if (remember && nextRoute.path !== route.path) history.push(route.path);
		if (route.path !== nextRoute.path) result = undefined;
		route = nextRoute;
		updatePage();
		const currentRevision = ++revision;
		void tick().then(() => {
			if (revision === currentRevision) {
				onNavigate?.(route.path);
				onStateChange?.({ path: route.path, result });
			}
		});
	}

	$effect(() => {
		if (path !== undefined) {
			const next = path;
			untrack(() => navigate(next));
		}
	});

	function resultChanged(value: ResultViewChange) {
		result = value;
		onStateChange?.({ path: route.path, result: value });
	}

	function fromResolved(url: string) {
		return base && url.startsWith(base + '/') ? url.slice(base.length) : url;
	}

	// Route anchors locally instead of loading a SvelteKit router or navigating the host document.
	function links(node: HTMLElement) {
		function click(event: MouseEvent) {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			const anchor = (event.target as Element)?.closest('a');
			const href = anchor?.getAttribute('href');
			if (
				!href?.startsWith('/') ||
				href.startsWith('//') ||
				anchor?.target ||
				anchor?.hasAttribute('download')
			)
				return;
			event.preventDefault();
			navigate(fromResolved(href));
		}
		node.addEventListener('click', click);
		return { destroy: () => node.removeEventListener('click', click) };
	}

	onMount(() => {
		const restore = setNavigationHandler((url) => navigate(fromResolved(url)));
		// Controlled startup is acknowledged by its navigation effect, not a competing mount callback.
		if (path === undefined) navigate(route.path, false);
		return () => {
			revision++;
			restore();
		};
	});
</script>

<div use:links class="flex min-h-0 min-w-0 flex-1 flex-col bg-ig-surface text-ig-text">
	{#if showNavigation}
		<nav aria-label={t('Navigation')} class="flex flex-wrap border-b border-ig-border">
			<NavbarLink href={resolve('/')} title={t('Environments')}><Server /></NavbarLink>
			<NavbarLink href={resolve('/browse/artifacthub')} title={t('Gadget Gallery')}
				><ArtifactHub /></NavbarLink
			>
			<NavbarLink href={resolve('/environment/create')} title={t('Create Environment')}
				><Plus /></NavbarLink
			>
		</nav>
	{/if}
	{#key route.path}
		{#if route.screen === 'environments'}
			<EnvironmentList title={homeTitle} />
		{:else if route.screen === 'create'}
			<EnvironmentCreate />
		{:else if route.screen === 'catalog'}
			<ArtifactHubList />
		{:else if route.screen === 'artifact'}
			<ArtifactHubDetail data={{ url: route.params.path }} />
		{:else if route.screen === 'launch'}
			<GadgetLaunch data={{ url: route.params.path, preset: launchPreset }} />
		{:else if route.screen === 'environment' || route.screen === 'result'}
			<EnvironmentLayout {showTabs}>
				{#if route.screen === 'result'}
					<Gadget
						instanceID={route.params.instanceID}
						{viewState}
						onViewStateChange={resultChanged}
					/>
				{:else}
					<EnvironmentDetail />
				{/if}
			</EnvironmentLayout>
		{:else if route.screen === 'session' && sessions}
			<SessionDetail {viewState} onViewStateChange={resultChanged} />
		{:else}
			<p class="p-8">{t('Page not found')}</p>
		{/if}
	{/key}
	<ConfirmationModal />
	<ConfigurationModal bind:open={settingsDialog.open} />
	{#if showToasts}
		<ToastContainer />
	{/if}
</div>
