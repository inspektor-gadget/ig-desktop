<script lang="ts">
	import { getContext, setContext, onMount, onDestroy, untrack } from 'svelte';
	import { getErrorMessage } from '$lib/utils/errors';
	import type { ApiContext } from '$lib/types/context';
	import Params from '$lib/components/Params.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Play from '$lib/icons/play.svelte';
	import ChevronLeft from '$lib/icons/chevron-left.svelte';
	import ChevronRight from '$lib/icons/chevron-right.svelte';
	import Copy from '$lib/icons/copy.svelte';
	import Cog from '$lib/icons/cog.svelte';
	import Code from '$lib/icons/code.svelte';
	import File from '$lib/icons/file.svelte';
	import Server from '$lib/icons/server.svelte';
	import { environments } from '$lib/shared/environments.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Title from '$lib/components/params/Title.svelte';
	import Select from '$lib/components/forms/Select.svelte';
	import type {
		FileOutputCapability,
		FileOutputFormat,
		FileOutputRequest,
		GadgetInfo,
		GadgetRunRequest,
		SessionItem
	} from '$lib/types';
	import type { GadgetLaunchPreset, EmbeddableAppProps } from '$lib/types/embedding';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import {
		addGadgetToHistory,
		saveGadgetURLRecent,
		saveK8sRecent
	} from '$lib/utils/env-preferences';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { analyticsService } from '$lib/services/analytics.service.svelte';
	import { configuration } from '$lib/stores/configuration.svelte';
	import { currentSessionStore } from '$lib/stores/current-session.svelte';
	import { features } from '$lib/config/app-mode';
	import { t } from '$lib/i18n/index.svelte';
	import { BackendCommandError, UncertainCommandError } from '$lib/services/api.service.svelte';

	// Redirect to home if running gadgets is not allowed (demo mode)
	onMount(() => {
		if (!features.canRunGadgets) {
			goto(resolve('/'));
		}
	});

	let { data }: { data: { url: string; preset?: GadgetLaunchPreset } } = $props();

	// Hosts may pass an equal preset object on every render: apply it once per route and content.
	// Effects read these primitives so that a new `data` wrapper alone does not re-run them.
	const imageURL = $derived(data.url);
	const presetKey = $derived(data.preset ? JSON.stringify(data.preset) : '');
	let appliedPresetKey = untrack(() => presetKey);
	let preset = $state.raw<GadgetLaunchPreset | undefined>(
		untrack(() => (data.preset ? $state.snapshot(data.preset) : undefined))
	);
	let launchRevision = $state(0);

	const api = getContext<ApiContext>('api');
	const goBack = getContext<(() => void) | undefined>('navigateBack') ?? (() => history.back());
	const hostSessionRecording = getContext<(() => boolean) | undefined>('sessionRecordingEnabled');
	const hostFileOutput = getContext<(() => FileOutputCapability | undefined) | undefined>(
		'fileOutput'
	);
	const hostLaunchPreferences = getContext<(() => boolean) | undefined>('launchPreferences');
	const hostFocusLaunchAction = getContext<(() => boolean) | undefined>('focusLaunchAction');
	const hostLaunchParameters = getContext<
		(() => EmbeddableAppProps['resolveLaunchParameters']) | undefined
	>('resolveLaunchParameters');
	let contextWarnings = $state<string[]>([]);
	let contextParameterKeys: string[] = [];
	const launchPreferences = $derived(hostLaunchPreferences?.() ?? false);
	let runButton: HTMLButtonElement;
	// One attempt per loaded metadata: later state changes must not move focus to Run,
	// where a stray Enter would start the gadget.
	let focusAttemptFor: GadgetInfo | null = null;
	$effect(() => {
		const info = gadgetInfo;
		if (!info || !runButton || info === focusAttemptFor) return;
		focusAttemptFor = info;
		untrack(() => {
			if (
				hostFocusLaunchAction?.() &&
				!contextWarnings.length &&
				canRun() &&
				document.hasFocus() &&
				(document.activeElement === document.body ||
					document.activeElement === document.documentElement)
			) {
				runButton.focus();
			}
		});
	});
	const hasExplicitParams = $derived(page.url.searchParams.has('params'));
	let usingSavedOptions = $state(false);
	let starting = $state(false);
	let resetting = $state(false);
	let startUncertain = $state(false);
	let parameterRevision = $state(0);
	type CustomOptions = { params: Record<string, string>; output?: { format: FileOutputFormat } };

	let environmentID = $state<string | null>(null);
	let detached = $state(false);
	let instanceName = $state('');
	let values = $state<Record<string, string>>({});
	let gadgetInfo = $state<GadgetInfo | null>(null);
	let commandType = $state<'ig' | 'gadgetctl' | 'kubectl'>('ig');
	let showAdvanced = $state(true);
	let outputMode = $state<'table' | 'file'>('table');
	let outputFormat = $state<FileOutputFormat>('jsonl');
	let outputSelection = $state<(FileOutputRequest & { path?: string; host?: string }) | null>(null);
	const fileOutput = $derived(hostFileOutput?.());
	const pcapDatasources = $derived(
		(gadgetInfo?.datasources ?? gadgetInfo?.dataSources ?? []).filter((datasource) =>
			datasource.annotations?.['cli.supported-output-modes']
				?.split(',')
				.map((mode) => mode.trim())
				.includes('pcap-ng')
		)
	);
	const supportedFormats = $derived(
		fileOutput
			? [
					...(fileOutput.formats.includes('jsonl') ? (['jsonl'] as const) : []),
					...(fileOutput.formats.includes('pcap-ng') && pcapDatasources.length === 1
						? (['pcap-ng'] as const)
						: [])
				]
			: []
	);
	const fileOutputAvailable = $derived(supportedFormats.length > 0);

	function clearFileSelection() {
		const token = untrack(() => outputSelection?.token);
		outputSelection = null;
		if (token) void api.request({ cmd: 'releaseFileOutput', data: { token } }).catch(() => {});
	}
	onDestroy(clearFileSelection);

	async function chooseFileOutput(startAfterSelection = false) {
		if (!fileOutput) return;
		clearFileSelection();
		try {
			const selection = await api.request<FileOutputRequest & { path: string; host: string }>({
				cmd: 'selectFileOutput',
				data: {
					format: outputFormat,
					...(startAfterSelection ? { startAfterSelection: true } : {})
				}
			});
			if (selection?.token) outputSelection = selection;
		} catch (err) {
			toastStore.error(getErrorMessage(err));
		}
	}

	// Experimental feature flag for session recording
	const sessionRecordingEnabled = $derived(
		!preset?.transient &&
			(hostSessionRecording?.() ?? configuration.get('experimentalSessionRecording') === true)
	);

	// Session recording state - initialize from configuration
	let alwaysRecord = $derived(configuration.get('alwaysRecord') === true);
	let singleSessionPerStart = $derived(configuration.get('singleSessionPerStart') !== false);
	let recordGadgetRun = $state(false);
	let sessionMode = $state<'new' | 'existing'>('new');
	let sessionName = $state('');
	let selectedSessionId = $state('');
	let existingSessions = $state<SessionItem[]>([]);

	// Convert sessions to options for Select component
	const sessionOptions = $derived(
		existingSessions.map((s) => ({
			value: s.id,
			label: `${s.name || 'Unnamed'} (${s.runCount} runs)`
		}))
	);

	// Initialize recordGadgetRun from alwaysRecord setting on mount
	// Also reset when detached mode is enabled (session recording doesn't make sense for detached)
	$effect(() => {
		if (detached || preset?.transient) {
			recordGadgetRun = false;
		} else if (preset?.record !== undefined) {
			recordGadgetRun = preset.record;
		} else if (sessionRecordingEnabled && alwaysRecord) {
			recordGadgetRun = true;
		} else if (!sessionRecordingEnabled) {
			recordGadgetRun = false;
		}
	});

	function canRun(): boolean {
		if (!environmentID || !gadgetInfo || error || starting || resetting || startUncertain)
			return false;
		if (outputMode === 'file' && !outputSelection?.token && !launchPreferences) return false;
		if (
			outputMode !== 'file' &&
			sessionRecordingEnabled &&
			recordGadgetRun &&
			sessionMode === 'existing' &&
			!selectedSessionId
		) {
			return false; // must select existing session
		}
		return true;
	}

	// Update commandType based on selected environment
	$effect(() => {
		if (!environmentID) return;
		const env = environments[environmentID];
		if (env) {
			// Set to kubectl if runtime contains 'kubernetes', otherwise ig
			commandType = env.runtime && env.runtime.toLowerCase().includes('k8s') ? 'kubectl' : 'ig';
		}
	});

	setContext('currentGadget', () => gadgetInfo);
	setContext('environmentID', () => environmentID);

	let error = $state<string | null>(null);
	let originalError = $state<string | null>(null);
	let retryTrigger = $state(0);

	// Load initial values from the preset or URL parameters, once per launch input revision.
	let appliedLaunchKey: string | undefined;
	$effect(() => {
		const key = `${imageURL}\n${page.url.search}\n${presetKey}`;
		if (key === appliedLaunchKey) return;
		appliedLaunchKey = key;
		untrack(() => {
			if (presetKey !== appliedPresetKey) {
				appliedPresetKey = presetKey;
				preset = data.preset ? $state.snapshot(data.preset) : undefined;
			}
			applyLaunchInputs();
			launchRevision++;
		});
	});

	function applyLaunchInputs() {
		environmentID = preset?.environmentID ?? page.url.searchParams.get('env');
		detached = preset?.transient
			? false
			: (preset?.detached ?? page.url.searchParams.get('detached') === 'true');
		instanceName = preset?.instanceName ?? (page.url.searchParams.get('instanceName') || '');
		if (preset?.sessionId) {
			sessionMode = 'existing';
			selectedSessionId = preset.sessionId;
		} else if (preset?.sessionName) {
			sessionMode = 'new';
			sessionName = preset.sessionName;
		}

		const paramsStr = page.url.searchParams.get('params');
		if (preset?.params) {
			values = { ...preset.params };
		} else if (paramsStr) {
			try {
				values = JSON.parse(paramsStr);
			} catch (e) {
				console.error('Failed to parse params from URL', e);
				values = {};
			}
		} else {
			values = {};
		}
	}

	// A destination is authorized only for this target, gadget and encoder.
	$effect(() => {
		void environmentID;
		void imageURL;
		void outputMode;
		void outputFormat;
		untrack(clearFileSelection);
	});

	let command = $derived.by(() => {
		let baseCmd = 'ig run';
		if (commandType === 'kubectl') {
			baseCmd = 'kubectl gadget run';
		} else if (commandType === 'gadgetctl') {
			baseCmd = 'gadgetctl run';
		}
		let cmd = baseCmd + ' ' + data.url;
		Object.keys(values).forEach((key) => {
			cmd += ' --' + key + '=' + values[key];
		});
		return cmd;
	});

	let manifest = $derived.by(() => {
		let manifest = 'apiVersion: 1\n';
		manifest += 'kind: instance-spec\n';
		manifest += 'image: ' + data.url + '\n';
		if (instanceName !== '') {
			manifest += 'name: ' + instanceName + '\n';
		}
		manifest += 'paramValues:\n';
		Object.keys(values).forEach((key) => {
			manifest += '  ' + key + ': ' + values[key] + '\n';
		});
		manifest += '---\n';
		return manifest;
	});

	function isTargetParameter(param: NonNullable<GadgetInfo['params']>[number]): boolean {
		return (
			/^(k8s|docker|container):/.test(param.valueHint ?? '') ||
			/^operator\.(KubeManager|LocalManager)\./.test((param.prefix ?? '') + param.key)
		);
	}

	/**
	 * The launcher's single source of default output, used after metadata loads and on Reset.
	 * A requested (preset/URL/history) or saved format is honored only when this host and gadget
	 * support it; otherwise the launcher falls back to table output with a supported format.
	 */
	function resolveInitialOutput(
		saved: CustomOptions | null,
		reset = false
	): { mode: 'table' | 'file'; format: FileOutputFormat; unavailable: boolean } {
		const requested = reset
			? undefined
			: (preset?.output?.format ?? (page.url.searchParams.get('output') || undefined));
		// Explicit Recent/URL launches start from table output unless they name a format.
		const packetFirst =
			launchPreferences && (reset || (preset?.restoreDefaults !== false && !hasExplicitParams));
		const format =
			requested ??
			(saved
				? saved.output?.format
				: packetFirst && supportedFormats.includes('pcap-ng')
					? 'pcap-ng'
					: undefined);
		const supported = supportedFormats.find((candidate) => candidate === format);
		const fallback =
			launchPreferences && supportedFormats.includes('pcap-ng')
				? 'pcap-ng'
				: (supportedFormats[0] ?? 'jsonl');
		return {
			mode: supported ? 'file' : 'table',
			format: supported ?? fallback,
			unavailable: !!format && !supported
		};
	}

	function applyInitialOutput(saved: CustomOptions | null, reset = false) {
		const output = resolveInitialOutput(saved, reset);
		outputMode = output.mode;
		outputFormat = output.format;
		if (output.unavailable) {
			toastStore.warning(
				t(
					'The previous output format is unavailable for this gadget or host. Review the output before starting.'
				)
			);
		}
	}

	async function resetCustomOptions() {
		if (resetting || starting || !gadgetInfo) return;
		resetting = true;
		try {
			await api.request({ cmd: 'resetGadgetDefaults', data: { image: data.url } });
			const targetKeys = new Set([
				...contextParameterKeys,
				...(gadgetInfo?.params ?? [])
					.filter(isTargetParameter)
					.map((param) => (param.prefix ?? '') + param.key)
			]);
			values = Object.fromEntries(Object.entries(values).filter(([key]) => targetKeys.has(key)));
			parameterRevision++;
			usingSavedOptions = false;
			applyInitialOutput(null, true);
			clearFileSelection();
		} catch (err) {
			toastStore.error(getErrorMessage(err));
		} finally {
			resetting = false;
		}
	}

	$effect(() => {
		if (!environmentID) return;

		// retryTrigger is used to force re-fetch when retry button is clicked
		void retryTrigger;
		// A changed preset or URL re-resolves saved options and host prefills.
		void launchRevision;

		// Reset states when environment changes
		error = null;
		originalError = null;
		gadgetInfo = null;
		contextWarnings = [];
		usingSavedOptions = false;
		let cancelled = false;
		const restore = launchPreferences && preset?.restoreDefaults !== false && !hasExplicitParams;
		const image = imageURL;
		const target = environmentID;

		Promise.all([
			api.request<GadgetInfo | null>({
				cmd: 'getGadgetInfo',
				data: { url: image, environmentID: target }
			}),
			restore
				? api.request<CustomOptions | null>({ cmd: 'getGadgetDefaults', data: { image } })
				: Promise.resolve(null)
		])
			.then(([res, saved]) => {
				if (cancelled) return;
				if (!res) {
					error = t('Could not fetch gadget information. Is the given URL correct?');
					originalError = null;
					return;
				}
				error = null;
				originalError = null;
				gadgetInfo = res;
				if (launchPreferences) {
					if (saved) {
						const allowed = new Map(
							(res.params ?? [])
								.filter((param) => !isTargetParameter(param))
								.map((param) => [(param.prefix ?? '') + param.key, param])
						);
						const entries = Object.entries(saved.params).filter(([key, value]) => {
							const param = allowed.get(key);
							return (
								param && (!param.possibleValues?.length || param.possibleValues.includes(value))
							);
						});
						const changed = Object.keys(saved.params).some(
							(key) =>
								!entries.some(([name]) => name === key) &&
								!(res.params ?? []).some(
									(param) => (param.prefix ?? '') + param.key === key && isTargetParameter(param)
								)
						);
						if (changed)
							toastStore.warning(
								t(
									'Some saved parameters are no longer supported. Review the custom options before starting.'
								)
							);
						values = { ...Object.fromEntries(entries), ...values };
						usingSavedOptions = true;
					}
				}
				applyInitialOutput(launchPreferences ? saved : null);
				const prefill = hostLaunchParameters?.()?.(res, target);
				if (prefill || contextParameterKeys.length) {
					values = {
						...Object.fromEntries(
							Object.entries(values).filter(([key]) => !contextParameterKeys.includes(key))
						),
						...prefill?.params
					};
					contextParameterKeys = Object.keys(prefill?.params ?? {});
					contextWarnings = prefill?.warnings ?? [];
					parameterRevision++;
				}
			})
			.catch((err) => {
				if (cancelled) return;
				console.error('Failed to fetch gadget information:', err);
				originalError = err?.message || String(err);
				error = t(
					'Failed to fetch gadget information. Please check your environment connection and try again.'
				);
				gadgetInfo = null;
			});
		return () => {
			cancelled = true;
		};
	});

	// Load existing sessions when recording is enabled
	$effect(() => {
		if (sessionRecordingEnabled && recordGadgetRun && environmentID) {
			loadExistingSessions();
		}
	});

	async function loadExistingSessions() {
		try {
			existingSessions = (await api.listSessions(environmentID!)) || [];

			// If single-session-per-start is enabled and we have a stored session,
			// pre-select "existing" mode and select that session for better UX
			if (singleSessionPerStart && environmentID) {
				const storedSessionId = currentSessionStore.get(environmentID);
				if (storedSessionId) {
					// Verify the stored session exists in the list
					const sessionExists = existingSessions.some((s) => s.id === storedSessionId);
					if (sessionExists) {
						sessionMode = 'existing';
						selectedSessionId = storedSessionId;
					}
				}
			}
		} catch (err) {
			console.error('Failed to load sessions:', err);
			existingSessions = [];
		}
	}

	async function runGadget() {
		// Determine session ID to use (only when feature is enabled)
		let sessionIdToUse: string | undefined;
		const shouldRecord = sessionRecordingEnabled && recordGadgetRun;
		if (shouldRecord) {
			if (sessionMode === 'existing') {
				sessionIdToUse = selectedSessionId || undefined;
			} else if (singleSessionPerStart && environmentID) {
				// Check for existing session in single-session-per-start mode
				sessionIdToUse = currentSessionStore.get(environmentID);
			}
		}

		const gadgetRunRequest: GadgetRunRequest = {
			image: data.url,
			params: $state.snapshot(values),
			environmentID: environmentID || undefined,
			detached: outputMode === 'file' || preset?.transient ? false : detached,
			instanceName,
			timestamp: Date.now(),
			record: outputMode === 'file' ? false : shouldRecord,
			sessionId: sessionIdToUse,
			sessionName:
				outputMode !== 'file' && !preset?.transient && sessionMode === 'new' && !sessionIdToUse
					? sessionName
					: undefined,
			...(launchPreferences ? { rememberOptions: true } : {})
		};
		if (outputMode === 'file') gadgetRunRequest.sessionId = undefined;
		if (outputMode === 'file' && outputSelection?.token) {
			gadgetRunRequest.output = {
				token: outputSelection.token,
				format: outputFormat,
				datasourceIds:
					outputFormat === 'pcap-ng'
						? pcapDatasources.map((datasource) => datasource.name)
						: undefined
			};
		}

		// Save K8s parameter values to recent lists
		if (!preset?.transient && environmentID && gadgetInfo?.params) {
			for (const param of gadgetInfo.params) {
				// Only save K8s parameters that have values
				if (param.valueHint?.startsWith('k8s:') && values[(param.prefix || '') + param.key]) {
					const resourceType = param.valueHint.replace('k8s:', '');
					const value = values[(param.prefix || '') + param.key];

					// For arrays (comma-separated), save each value
					if (typeof value === 'string' && value.includes(',')) {
						const parts = value
							.split(',')
							.map((v) => v.trim())
							.filter((v) => v);
						parts.forEach((v) => saveK8sRecent(environmentID!, resourceType, v));
					} else if (value) {
						saveK8sRecent(environmentID!, resourceType, String(value));
					}
				}
			}
		}

		try {
			const res = await api.request<{ id: string }>({ cmd: 'runGadget', data: gadgetRunRequest });
			clearFileSelection();

			// Track gadget run if analytics is enabled
			analyticsService.trackRunGadget(data.url);

			// Save gadget URL to recents
			if (!preset?.transient && environmentID && data.url) {
				saveGadgetURLRecent(environmentID!, data.url);
			}

			// Add to per-environment history with deduplication (max 50 entries)
			if (!preset?.transient && environmentID) {
				addGadgetToHistory(environmentID!, gadgetRunRequest, 50);
			}

			if (detached && outputMode !== 'file') {
				// Show info toast for headless instances (success confirmed when instance appears in list)
				const displayName = instanceName || 'Unnamed instance';
				toastStore.info(
					t('Starting headless instance "{{displayName}}"...', { displayName }),
					3000
				);
				goto(resolve(`/env/${environmentID}`));
			} else {
				goto(resolve(`/env/${environmentID}/running/${res.id}`));
			}
		} catch (err) {
			const fileStartRejected = outputMode === 'file' && err instanceof BackendCommandError;
			const fileStartUncertain = err instanceof UncertainCommandError;
			if (fileStartRejected) clearFileSelection();
			if (fileStartUncertain) {
				startUncertain = true;
				if (fileOutput?.notify !== false) {
					toastStore.error(
						t(
							'Capture start outcome is unknown. Inspect active captures before choosing another destination.'
						),
						7000
					);
				}
				return;
			}
			// Show error toast
			const errorMessage = getErrorMessage(err);
			toastStore.error(
				detached
					? t('Failed to start headless instance: {{errorMessage}}', { errorMessage })
					: t('Failed to start gadget: {{errorMessage}}', { errorMessage }),
				7000,
				fileStartRejected
					? undefined
					: {
							label: t('Retry'),
							onClick: () => startGadget()
						}
			);
		}
	}

	async function startGadget() {
		if (!canRun()) return;
		starting = true;
		try {
			if (launchPreferences && outputMode === 'file' && !outputSelection?.token) {
				await chooseFileOutput(true);
				if (!outputSelection?.token) return;
			}
			await runGadget();
		} finally {
			starting = false;
		}
	}

	async function copyCommand() {
		await copyToClipboard(command);
	}

	async function copyManifest() {
		await copyToClipboard(manifest);
	}
</script>

<div class="flex flex-row items-center justify-between bg-white dark:bg-gray-950 p-4">
	<div class="flex flex-row items-center gap-4">
		<button
			onclick={goBack}
			class="flex cursor-pointer items-center rounded-ig-sm bg-gray-200 dark:bg-gray-800 p-1.5 hover:bg-gray-300 dark:hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-ig-primary"
			title={t('Go back')}
		>
			<ChevronLeft />
		</button>
		<div>{data.url}</div>
	</div>
	<div>
		<div class="grid">
			<svg
				class="pointer-events-none relative right-1 z-10 col-start-1 row-start-1 h-4 w-4 self-center justify-self-end forced-colors:hidden"
				viewBox="0 0 16 16"
				fill="currentColor"
				aria-hidden="true"
			>
				<path
					fill-rule="evenodd"
					d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
					clip-rule="evenodd"
				></path>
			</svg>
			<select
				aria-label={t('Select environment')}
				bind:value={environmentID}
				disabled={preset?.transient || !!preset?.kubernetesTargetID}
				class="col-start-1 row-start-1 appearance-none rounded-ig-sm bg-gray-200 dark:bg-gray-800 p-1.5 pr-8 pl-3 focus-visible:ring-2 focus-visible:ring-ig-primary"
			>
				<option value="">{t('Select environment')}</option>
				{#each Object.entries(environments) as [id, environment] (id)}
					<option value={environment.id}>{environment.name}</option>
				{/each}
			</select>
		</div>
	</div>
</div>

<div class="flex grow flex-col overflow-auto bg-gray-50/80 dark:bg-gray-950/80 p-8">
	{#if preset?.transient}
		<p role="status" class="mb-4 text-sm text-ig-text-secondary">
			{t('Ad-hoc Kubernetes target: not saved. Only foreground, unrecorded runs are available.')}
		</p>
	{:else if preset?.kubernetesTargetID}
		<p role="status" class="mb-4 text-sm text-ig-text-secondary">
			{preset.kubernetesTargetName}
		</p>
	{/if}
	{#each contextWarnings as warning, index (index)}
		<p role="alert" class="mb-4 rounded-ig-sm border border-ig-warning p-3 text-sm text-ig-text">
			{warning}
		</p>
	{/each}
	<div class="mx-auto flex w-full max-w-7xl flex-row gap-6">
		<div class="flex grow flex-col gap-6">
			{#if !gadgetInfo}
				{#if error}
					<div
						class="flex flex-col gap-4 rounded-ig-lg border border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/50 p-6 shadow-lg"
					>
						<div class="flex flex-row items-start gap-4">
							<div class="flex-shrink-0 text-red-600 dark:text-red-400">
								<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
							</div>
							<div class="flex-1">
								<h3 class="text-lg font-semibold text-red-700 dark:text-red-300">
									{t('Failed to Load Gadget Information')}
								</h3>
								<p class="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>

								<div class="mt-4 text-sm text-red-700/80 dark:text-red-300/80">
									<p class="font-semibold">{t('Possible causes:')}</p>
									<ul class="mt-2 ml-4 list-disc space-y-1">
										<li>{t('The gadget URL is incorrect or the gadget does not exist')}</li>
										<li>{t("The gadget's signature was not accepted or present")}</li>
										<li>{t('The selected environment is not reachable or not running')}</li>
										<li>{t('Network connectivity issues between the app and the environment')}</li>
										<li>{t('The environment does not have access to the gadget registry')}</li>
									</ul>
								</div>

								{#if originalError}
									<div
										class="mt-3 rounded-ig-sm border border-red-300/50 dark:border-red-800/50 bg-red-100/30 dark:bg-red-900/30 p-3"
									>
										<p class="text-xs font-semibold text-red-700/90 dark:text-red-300/90">
											{t('Error details:')}
										</p>
										<p class="mt-1 font-mono text-xs text-red-600/80 dark:text-red-400/80">
											{originalError}
										</p>
									</div>
								{/if}

								<button
									onclick={() => {
										retryTrigger++;
									}}
									class="mt-4 rounded-ig-sm bg-red-600 dark:bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 dark:hover:bg-red-700"
								>
									{t('Retry')}
								</button>
							</div>
						</div>
					</div>
				{:else if !environmentID}
					<Panel title={t('Select Environment')} icon={Server} color="blue">
						<div class="flex flex-col gap-4">
							<p class="text-sm text-gray-600 dark:text-gray-400">
								{t(
									'Choose an environment to run this gadget on. Environments define where and how the gadget will execute.'
								)}
							</p>

							{#if Object.keys(environments).length === 0}
								<div
									class="flex flex-col items-center justify-center rounded-ig-md border-2 border-dashed border-gray-300 dark:border-gray-700 bg-gray-100/30 dark:bg-gray-900/30 p-8 text-center"
								>
									<div class="mb-3 text-gray-500"><Server /></div>
									<p class="text-sm font-medium text-gray-600 dark:text-gray-400">
										{t('No environments configured')}
									</p>
									<p class="mt-2 text-xs text-gray-500">
										{t('Add an environment in the Environments section to get started.')}
									</p>
								</div>
							{:else}
								<div class="flex flex-col gap-2">
									{#each Object.entries(environments) as [id, environment] (id)}
										<button
											onclick={() => {
												environmentID = environment.id;
											}}
											class="group/item flex items-center justify-between rounded-ig-md border border-gray-200 dark:border-gray-800 bg-gray-100/50 dark:bg-gray-900/50 px-4 py-3 text-left transition-all hover:border-blue-500/50 hover:bg-gray-100 dark:hover:bg-gray-900"
										>
											<div class="flex flex-col gap-1">
												<div class="font-medium text-gray-800 dark:text-gray-200">
													{environment.name}
												</div>
												<div class="text-xs text-gray-600 dark:text-gray-400">
													{environment.runtime}
												</div>
											</div>
											<div
												class="text-gray-400 dark:text-gray-600 transition-all group-hover/item:translate-x-1 group-hover/item:text-blue-400"
											>
												<ChevronRight />
											</div>
										</button>
									{/each}
								</div>

								<div
									class="mt-2 rounded-ig-md border border-blue-200/30 dark:border-blue-900/30 bg-blue-50/20 dark:bg-blue-950/20 p-3 text-xs text-blue-700/80 dark:text-blue-300/80"
								>
									<span class="font-semibold">{t('Tip:')}</span>
									{t('You can also use the environment selector in the top-right corner.')}
								</div>
							{/if}
						</div>
					</Panel>
				{:else}
					<div class="flex items-center justify-center p-8">
						<Spinner message={t('Loading gadget information...')} />
					</div>
				{/if}
			{:else}
				{#if launchPreferences}
					<div class="flex items-center justify-between gap-3 text-sm">
						<span class="text-ig-text-muted"
							>{usingSavedOptions
								? t('Using your last custom options')
								: t('Custom options are remembered after a successful start')}</span
						>
						<button
							disabled={starting || resetting || !gadgetInfo}
							onclick={resetCustomOptions}
							class="text-ig-primary underline focus-visible:ring-2 focus-visible:ring-ig-primary"
							>{t('Reset to gadget defaults')}</button
						>
					</div>
				{/if}
				{#if fileOutputAvailable}
					<Panel title={t(launchPreferences ? 'Output' : 'Mode')} icon={File} color="blue">
						<div class="flex flex-col gap-4">
							{#if launchPreferences}
								<label class="flex max-w-sm flex-col gap-1 text-sm">
									<span>{t('Output')}</span>
									<select
										aria-label={t('Output')}
										disabled={starting || resetting}
										value={outputMode === 'table' ? 'table' : outputFormat}
										onchange={(event) => {
											const value = event.currentTarget.value;
											outputMode = value === 'table' ? 'table' : 'file';
											if (value === 'jsonl' || value === 'pcap-ng') outputFormat = value;
										}}
										class="border-ig-border-strong bg-ig-surface-raised rounded-ig-sm border p-2 text-ig-text"
									>
										<option value="table">{t('Live table')}</option>
										{#if supportedFormats.includes('pcap-ng')}<option value="pcap-ng"
												>{t('PCAP-ng file')}</option
											>{/if}
										{#if supportedFormats.includes('jsonl')}<option value="jsonl"
												>{t('JSON Lines file')}</option
											>{/if}
									</select>
								</label>
							{:else}
								<label class="flex max-w-sm flex-col gap-1 text-sm">
									<span>{t('Mode')}</span>
									<select
										aria-label={t('Mode')}
										bind:value={outputMode}
										class="border-ig-border-strong bg-ig-surface-raised rounded-ig-sm border p-2 text-ig-text"
									>
										<option value="table">{t('Default table view')}</option>
										<option value="file">{t('To a file')}</option>
									</select>
								</label>
							{/if}
							{#if outputMode === 'file'}
								<div class="flex flex-col gap-3 rounded-ig-md border border-ig-border p-3">
									{#if !launchPreferences}
										<label class="flex flex-col gap-1 text-sm">
											<span>{t('Format')}</span>
											<select
												aria-label={t('Format')}
												bind:value={outputFormat}
												class="border-ig-border-strong bg-ig-surface-raised rounded-ig-sm border p-2 text-ig-text"
											>
												{#each supportedFormats as format (format)}
													<option value={format}
														>{format === 'jsonl'
															? 'JSON Lines (.jsonl)'
															: 'PCAP-NG (.pcapng)'}</option
													>
												{/each}
											</select>
										</label>
									{/if}
									<p class="text-sm text-ig-text-muted">
										{t(
											'File captures run in the foreground and are not recorded to a session, so headless and recording options do not apply.'
										)}
									</p>
									{#if outputFormat === 'pcap-ng' && pcapDatasources.length !== 1}
										<p role="alert" class="text-sm text-ig-error">
											{t('PCAP-NG requires exactly one packet datasource.')}
										</p>
									{/if}
									<div class="flex items-center gap-3">
										{#if !launchPreferences || outputSelection?.path}
											<button
												aria-label={t('Choose destination')}
												disabled={starting}
												onclick={() => chooseFileOutput()}
												class="rounded-ig-sm border border-ig-border-strong px-3 py-2 text-sm hover:bg-ig-border"
											>
												{outputSelection?.path ? t('Change destination') : t('Choose destination')}
											</button>
										{/if}
										{#if outputSelection?.path}
											<span class="break-all text-sm text-ig-text-secondary"
												>{outputSelection.path} ({outputSelection.host})</span
											>
										{:else}
											<span class="text-sm text-ig-text-muted"
												>{launchPreferences
													? t('You will choose a destination on {{host}} when starting.', {
															host: fileOutput?.host ?? ''
														})
													: t('Choose a destination on {{host}} before starting.', {
															host: fileOutput?.host ?? ''
														})}</span
											>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					</Panel>
				{/if}
				{#if !preset?.transient && outputMode !== 'file'}
					<!-- Panel-like container without header for detached settings -->
					<div
						class="main-gradient flex flex-col gap-4 rounded-ig-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 shadow-sm transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10"
					>
						<!-- Detached checkbox -->
						<label class="flex cursor-pointer flex-row gap-4">
							<div class="grid items-center justify-center">
								<input
									type="checkbox"
									class="peer col-start-1 row-start-1 h-4 w-4 appearance-none rounded-ig-sm border border-gray-300 ring-transparent checked:border-violet-600 checked:bg-violet-600 dark:border-gray-600 dark:checked:border-violet-600 focus-visible:ring-2 focus-visible:ring-ig-primary forced-colors:appearance-auto"
									bind:checked={detached}
								/>
								<svg
									viewBox="0 0 14 14"
									fill="none"
									class="pointer-events-none invisible col-start-1 row-start-1 stroke-white peer-checked:visible dark:text-violet-300 forced-colors:hidden"
									><path
										d="M3 8L6 11L11 3.5"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									></path></svg
								>
							</div>
							<Title
								param={{
									title: t('Detached'),
									key: 'detached',
									description: t(
										'The server will keep running the gadget even after closing the app'
									)
								}}
							/>
						</label>

						<!-- Instance name input when detached -->
						{#if detached}
							<div class="flex flex-row gap-4">
								<div class="w-1/3">
									<Title
										param={{
											title: t('Instance Name'),
											key: 'instanceName',
											description: t('Descriptive name for the detached instance')
										}}
									/>
								</div>
								<div class="grow">
									<input
										aria-label={t('Instance Name')}
										class="w-full rounded-ig-sm bg-gray-200 dark:bg-gray-800 p-1.5 text-sm"
										type="text"
										placeholder={t('My Gadget')}
										bind:value={instanceName}
									/>
								</div>
							</div>
						{/if}
					</div>

					<!-- Session recording settings (experimental) - not available for detached instances -->
				{/if}
				{#if sessionRecordingEnabled && !detached && outputMode !== 'file'}
					<div
						class="main-gradient flex flex-col gap-4 rounded-ig-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 shadow-sm transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10"
					>
						<!-- Session recording toggle -->
						<label class="flex cursor-pointer flex-row gap-4">
							<div class="grid items-center justify-center">
								<input
									type="checkbox"
									class="peer col-start-1 row-start-1 h-4 w-4 appearance-none rounded-ig-sm border border-gray-300 ring-transparent checked:border-violet-600 checked:bg-violet-600 dark:border-gray-600 dark:checked:border-violet-600 focus-visible:ring-2 focus-visible:ring-ig-primary forced-colors:appearance-auto"
									bind:checked={recordGadgetRun}
								/>
								<svg
									viewBox="0 0 14 14"
									fill="none"
									class="pointer-events-none invisible col-start-1 row-start-1 stroke-white peer-checked:visible dark:text-violet-300 forced-colors:hidden"
									><path
										d="M3 8L6 11L11 3.5"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									></path></svg
								>
							</div>
							<Title
								param={{
									title: t('Record to Session'),
									key: 'recordToSession',
									description: t(
										'Save all gadget events to a session file for later replay and analysis'
									)
								}}
							/>
						</label>

						<!-- Session mode selection -->
						{#if recordGadgetRun}
							<div class="flex flex-col gap-3">
								<!-- New/Existing radio buttons -->
								<div class="flex flex-row gap-6">
									<label class="flex cursor-pointer items-center gap-2">
										<input
											type="radio"
											bind:group={sessionMode}
											value="new"
											class="h-4 w-4 cursor-pointer border-gray-300 text-violet-600 focus:ring-violet-600"
										/>
										<span class="text-sm text-gray-700 dark:text-gray-300">{t('New Session')}</span>
									</label>
									<label class="flex cursor-pointer items-center gap-2">
										<input
											type="radio"
											bind:group={sessionMode}
											value="existing"
											class="h-4 w-4 cursor-pointer border-gray-300 text-violet-600 focus:ring-violet-600"
										/>
										<span class="text-sm text-gray-700 dark:text-gray-300"
											>{t('Add to Existing')}</span
										>
									</label>
								</div>

								<!-- New session name input -->
								{#if sessionMode === 'new'}
									<input
										type="text"
										aria-label={t('Session name (optional)')}
										bind:value={sessionName}
										placeholder={t('Session name (optional)')}
										class="w-full rounded-ig-sm bg-gray-200 dark:bg-gray-800 p-2 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-violet-600 focus:outline-none"
									/>
								{/if}

								<!-- Existing session selector -->
								{#if sessionMode === 'existing'}
									<Select
										bind:value={selectedSessionId}
										options={sessionOptions}
										placeholder={t('Select a session...')}
										ariaLabel={t('Select a session...')}
										class="text-sm"
									/>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<Panel title={t('Parameters')} icon={Cog} color="blue">
					{#snippet headerActions()}
						<div class="flex flex-row items-center gap-2">
							<label class="flex cursor-pointer items-center gap-2 text-xs">
								<input type="checkbox" bind:checked={showAdvanced} />
								<span>{t('Show advanced options')}</span>
							</label>
						</div>
					{/snippet}

					{#key parameterRevision}
						<Params params={gadgetInfo.params ?? []} {values} {showAdvanced} />
					{/key}
				</Panel>
			{/if}
		</div>

		<div class="flex w-1/3 flex-col gap-6">
			<Panel title={t('Run Command')} icon={Code} color="green">
				{#snippet headerActions()}
					<button
						onclick={copyCommand}
						class="cursor-pointer rounded-ig-sm p-1 hover:bg-gray-200 dark:hover:bg-gray-700"
						title={t('Copy to clipboard')}
					>
						<Copy />
					</button>
				{/snippet}

				<div class="flex flex-col gap-4">
					<div class="rounded-ig-sm bg-gray-200 dark:bg-gray-800 p-3 font-mono text-xs">
						{command}
					</div>
					<div class="flex flex-row items-center">
						<button
							onclick={() => (commandType = 'ig')}
							class="flex-1 rounded-l-ig-sm px-2 py-1 text-xs transition-colors"
							class:bg-gray-400={commandType === 'ig'}
							class:dark:bg-gray-600={commandType === 'ig'}
							class:hover:bg-gray-300={commandType === 'ig'}
							class:dark:hover:bg-gray-500={commandType === 'ig'}
							class:bg-gray-300={commandType !== 'ig'}
							class:dark:bg-gray-700={commandType !== 'ig'}
							class:hover:bg-gray-400={commandType !== 'ig'}
							class:dark:hover:bg-gray-600={commandType !== 'ig'}
						>
							ig
						</button>
						<button
							onclick={() => (commandType = 'gadgetctl')}
							class="flex-1 px-2 py-1 text-xs transition-colors"
							class:bg-gray-400={commandType === 'gadgetctl'}
							class:dark:bg-gray-600={commandType === 'gadgetctl'}
							class:hover:bg-gray-300={commandType === 'gadgetctl'}
							class:dark:hover:bg-gray-500={commandType === 'gadgetctl'}
							class:bg-gray-300={commandType !== 'gadgetctl'}
							class:dark:bg-gray-700={commandType !== 'gadgetctl'}
							class:hover:bg-gray-400={commandType !== 'gadgetctl'}
							class:dark:hover:bg-gray-600={commandType !== 'gadgetctl'}
						>
							gadgetctl
						</button>
						<button
							onclick={() => (commandType = 'kubectl')}
							class="flex-1 rounded-r-ig-sm px-2 py-1 text-xs transition-colors"
							class:bg-gray-400={commandType === 'kubectl'}
							class:dark:bg-gray-600={commandType === 'kubectl'}
							class:hover:bg-gray-300={commandType === 'kubectl'}
							class:dark:hover:bg-gray-500={commandType === 'kubectl'}
							class:bg-gray-300={commandType !== 'kubectl'}
							class:dark:bg-gray-700={commandType !== 'kubectl'}
							class:hover:bg-gray-400={commandType !== 'kubectl'}
							class:dark:hover:bg-gray-600={commandType !== 'kubectl'}
						>
							kubectl
						</button>
					</div>
				</div>
			</Panel>

			<Panel title={t('Gadget Manifest')} icon={File} color="purple">
				{#snippet headerActions()}
					<button
						onclick={copyManifest}
						class="cursor-pointer rounded-ig-sm p-1 hover:bg-gray-200 dark:hover:bg-gray-700"
						title={t('Copy to clipboard')}
						aria-label={t('Copy gadget manifest to clipboard')}
					>
						<Copy />
					</button>
				{/snippet}

				<div
					class="rounded-ig-sm bg-gray-200 dark:bg-gray-800 p-3 font-mono text-xs whitespace-pre-wrap"
				>
					{manifest}
				</div>
			</Panel>
		</div>
	</div>
</div>

<div class="flex flex-row justify-between bg-white dark:bg-gray-950 p-4">
	<div></div>
	<div>
		<div class="flex flex-col items-end gap-2">
			{#if startUncertain}
				<p role="alert" class="text-sm text-ig-warning">
					{t('Capture start outcome is unknown. Inspect active captures before starting again.')}
				</p>
			{/if}
			{#if outputMode !== 'file' && sessionRecordingEnabled && recordGadgetRun && sessionMode === 'existing' && !selectedSessionId}
				<span class="text-xs text-yellow-600 dark:text-yellow-400"
					>{t('Please select a session to record to')}</span
				>
			{/if}
			<button
				bind:this={runButton}
				disabled={!canRun()}
				onclick={startGadget}
				class="flex cursor-pointer flex-row gap-2 rounded-ig-sm bg-green-600 dark:bg-green-800 py-2 pr-4 pl-2 text-white hover:bg-green-500 dark:hover:bg-green-700 focus-visible:ring-2 focus-visible:ring-ig-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-green-200 dark:disabled:bg-green-950 disabled:text-gray-500"
			>
				<span><Play /></span>
				<span
					>{starting
						? t('Starting...')
						: launchPreferences && outputMode === 'file' && !outputSelection?.token
							? t('Choose file and start...')
							: t('Run Gadget')}</span
				>
			</button>
		</div>
	</div>
</div>
