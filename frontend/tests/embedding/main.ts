import { mount } from 'svelte';
import type { EmbeddableAppProps, EmbeddableAppState } from '../../src/lib/types/embedding';
// Load the production artifact at runtime; do not typecheck generated/minified JS.
const libraryPath = '../../build-embedding/ig-frontend.js';
const {
	EmbeddableApp,
	DeployModalWrapper,
	initializeIG,
	createReactiveProps,
	apiService,
	toastStore,
	openExternalURL,
	setExternalURLOpener
} = await import(/* @vite-ignore */ libraryPath);
import '../../build-embedding/ig-frontend.css';

const query = new URLSearchParams(location.search);
let dashboardState = query.get('dashboard') || '';
let conflictVersion = '17';
let customOptions: Record<string, unknown> | null = query.has('savedOptions')
	? {
			params: { pid: '42', 'operator.KubeManager.namespace': 'old-namespace' },
			output: { format: 'jsonl' }
		}
	: null;
const environment = {
	id: 'test-env',
	name: 'Embedding environment',
	runtime: dashboardState && !query.has('nonK8s') ? 'grpc-k8s' : 'grpc',
	params: { 'gadget-namespace': 'custom-gadget' }
};
const gadgetInfo = {
	imageName: 'test/image:latest',
	params: [
		{ key: 'pid', title: 'PID', type: 'uint32', defaultValue: '0' },
		...(query.has('launchPreferences')
			? [
					{
						key: 'namespace',
						prefix: 'operator.KubeManager.',
						title: 'Namespace',
						type: 'string',
						defaultValue: '',
						valueHint: 'k8s:namespace'
					}
				]
			: [])
	],
	dataSources: [
		{
			name: 'events',
			fields: [{ name: 'comm', fullName: 'comm', kind: 'String', flags: 0, annotations: {} }],
			annotations: {
				'metrics.collect': 'true',
				...(query.has('pcap') ? { 'cli.supported-output-modes': 'pcap-ng' } : {})
			}
		}
	]
};
const requests: Array<{ cmd: string; reqID?: string; data?: Record<string, unknown> }> = [];
const states: EmbeddableAppState[] = [];
declare global {
	interface Window {
		embedding: {
			requests: typeof requests;
			states: EmbeddableAppState[];
			update: (next: Partial<EmbeddableAppProps>) => void;
			cleanup: () => void;
			cancelPending: () => Promise<boolean>;
			showToast: (duration?: number, reject?: boolean) => string;
			triggerToast: (id: string) => Promise<string>;
			toastClicks: () => number;
			externalLinks: () => Promise<
				Array<{ kind: string; url: string; target?: string; features?: string }>
			>;
			initialResultVisible: boolean;
			dashboard: (state: string) => void;
		};
	}
}
let receive = (_message: string) => {};
let connection = (_connected: boolean) => {};
let connected = false;
let toastClicks = 0;
function emit(message: unknown) {
	receive(JSON.stringify(message));
}
function metadata(id = 'run-one', attached = false) {
	emit({ type: 2, instanceID: id, environmentID: environment.id, attached, data: gadgetInfo });
	emit({
		type: 6,
		instanceID: id,
		datasourceID: 'events',
		data: [{ comm: 'alpha' }, { comm: 'beta' }]
	});
}
const adapter = {
	get connected() {
		return connected;
	},
	async connect() {
		connected = true;
		connection(true);
	},
	onMessage(handler: typeof receive) {
		receive = handler;
	},
	onConnectionChange(handler: typeof connection) {
		connection = handler;
	},
	disconnect() {
		connected = false;
		connection(false);
	},
	send(message: string) {
		const request = JSON.parse(message);
		requests.push(request);
		if (request.cmd === 'helo') {
			emit({ type: 100, data: environment });
			metadata();
			return;
		}
		if (request.cmd === 'pending') return;
		if (request.cmd === 'listInstances' && dashboardState) {
			if (dashboardState === 'loading') return;
			if (dashboardState !== 'connected') {
				emit({
					type: 1,
					reqID: request.reqID,
					success: false,
					error:
						dashboardState === 'missing'
							? 'No IG deployment found'
							: 'fixture connection/RBAC error',
					...(dashboardState === 'uncertain' ? { uncertain: true } : {}),
					data: ['missing', 'uncertain'].includes(dashboardState)
						? { deploymentMissing: true }
						: null
				});
				return;
			}
		}
		let data: unknown = {};
		switch (request.cmd) {
			case 'deployIG':
				if (dashboardState) {
					if (query.has('deployError')) {
						emit({
							type: 1,
							reqID: request.reqID,
							success: false,
							error: 'fixture deployment forbidden'
						});
						return;
					}
					data = { deploymentId: 'dashboard-deploy' };
					setTimeout(() => {
						const changedConflict =
							query.has('changedConflict') && request.data?.redeploy && conflictVersion === '17';
						if (changedConflict) conflictVersion = '18';
						if (
							((query.has('ownershipConflict') || query.has('unclassifiedConflict')) &&
								!request.data?.redeploy) ||
							changedConflict
						) {
							emit({
								type: 202,
								data: {
									deploymentId: 'dashboard-deploy',
									ownershipConflict: query.has('ownershipConflict'),
									error: changedConflict
										? 'The approved ConfigMap changed. Review and confirm the current resources.'
										: 'ConfigMap "gadget" exists and cannot be imported into the current release: invalid ownership metadata',
									...(query.has('exactConflicts')
										? {
												resourceConflicts: [
													{
														apiVersion: 'v1',
														kind: 'ConfigMap',
														namespace: 'custom-gadget',
														name: 'gadget',
														uid: 'configmap-uid',
														resourceVersion: conflictVersion
													},
													{
														apiVersion: 'v1',
														kind: 'ServiceAccount',
														namespace: 'custom-gadget',
														name: 'gadget',
														uid: 'serviceaccount-uid',
														resourceVersion: '23',
														...(query.has('blockedConflict')
															? { blockedReason: 'This resource has a Kubernetes owner reference.' }
															: {})
													}
												]
											}
										: {}),
									...(query.has('malformedConflicts')
										? { resourceConflicts: [{ kind: 'ConfigMap', name: 'gadget' }] }
										: {}),
									...(query.has('emptyConflicts') ? { resourceConflicts: [] } : {})
								}
							});
							return;
						}
						dashboardState = 'connected';
						emit({ type: 201, data: { deploymentId: 'dashboard-deploy', progress: 100 } });
					}, 50);
					break;
				}
				data = { deploymentId: 'undeploy-fixture' };
				setTimeout(
					() =>
						emit({
							type: 202,
							data: {
								deploymentId: 'undeploy-fixture',
								error: 'fixture permission denied',
								progress: 20
							}
						}),
					50
				);
				break;
			case 'getGadgetInfo':
				data = gadgetInfo;
				break;
			case 'getGadgetDefaults':
				data = customOptions;
				break;
			case 'resetGadgetDefaults':
				customOptions = null;
				data = null;
				break;
			case 'getChartValues':
				data = { values: 'config: {}' };
				break;
			case 'getRuntimes':
				data = [{ key: 'grpc', title: 'Host', description: 'Remote daemon' }];
				break;
			case 'getRuntimeParams':
				data = [];
				break;
			case 'listInstances':
				data = { gadgetInstances: [{ id: 'remote-one', name: 'Detached gadget' }] };
				break;
			case 'listSessions':
				data = [{ id: 'saved', name: 'Saved capture', runCount: 1, startedAt: Date.now() }];
				break;
			case 'getSession':
				data = {
					id: 'saved',
					name: 'Saved capture',
					environmentId: environment.id,
					createdAt: Date.now(),
					runs: [
						{
							id: 'recorded-run',
							gadgetImage: gadgetInfo.imageName,
							gadgetInfo,
							eventCount: 0,
							startedAt: Date.now()
						}
					]
				};
				break;
			case 'getArtifactHubPackage':
				data = {
					data: {
						name: 'fixture-gadget',
						version: '1.0',
						containers_images: [
							{ name: 'test/image:latest', image: 'test/image:latest', platforms: [] }
						]
					}
				};
				break;
			case 'runGadget':
				if (request.data?.rememberOptions) {
					const output = request.data.output as { format: string } | undefined;
					customOptions = {
						params: request.data.params,
						...(output ? { output: { format: output.format } } : {})
					};
				}
				metadata('manual-run');
				if (request.data?.output) {
					emit({
						type: 7,
						instanceID: 'manual-run',
						environmentID: environment.id,
						data: {
							format: request.data.output.format,
							path: '/captures/capture.jsonl',
							host: 'test host',
							state: 'running',
							records: 0,
							bytes: 0
						}
					});
					data = { id: 'manual-run', output: { format: request.data.output.format } };
				} else {
					data = { id: 'manual-run' };
				}
				break;
			case 'selectFileOutput':
				data = {
					token: 'selected-once',
					format: request.data?.format,
					path: '/captures/capture.jsonl',
					host: 'test host',
					overwrite: false
				};
				break;
			case 'attachInstance':
				metadata('attached-run', true);
				data = { id: 'attached-run' };
				break;
		}
		emit({ type: 1, reqID: request.reqID, success: true, data });
	}
};
const cleanup = initializeIG({ adapter, language: 'en' });
const props: EmbeddableAppProps = createReactiveProps({
	path: new URLSearchParams(location.search).get('initialPath') || '/',
	launchPreferences: query.has('launchPreferences'),
	...(new URLSearchParams(location.search).has('fileOutput')
		? {
				fileOutput: {
					formats: query.has('pcap') ? ['jsonl', 'pcap-ng'] : ['jsonl'],
					host: 'test host'
				}
			}
		: {}),
	onNavigate: (path: string) => {
		props.path = path;
	},
	onStateChange: (state: EmbeddableAppState) => {
		states.push(state);
		props.path = state.path;
	}
});
if (new URLSearchParams(location.search).has('undeploy')) {
	mount(DeployModalWrapper, {
		target: document.getElementById('app')!,
		props: { open: true, undeploy: true, clusterName: 'fixture-context', onClose: () => {} }
	});
} else {
	mount(EmbeddableApp, { target: document.getElementById('app')!, props });
}
Object.assign(window, {
	embedding: {
		requests,
		dashboard: (state: string) => {
			dashboardState = state;
			const pending = requests.findLast((request) => request.cmd === 'listInstances');
			if (pending)
				emit({
					type: 1,
					reqID: pending.reqID,
					success: state === 'connected',
					error: state === 'missing' ? 'No IG deployment found' : 'fixture connection/RBAC error',
					data: state === 'missing' ? { deploymentMissing: true } : { gadgetInstances: [] }
				});
		},
		states,
		initialResultVisible: !!document.querySelector('a[href="/env/test-env/running/run-one"]'),
		update: (next: object) => Object.assign(props, next),
		cleanup,
		cancelPending: () => {
			const pending = apiService.request({ cmd: 'pending' }).then(
				() => false,
				() => true
			);
			adapter.disconnect();
			return pending;
		},
		showToast: (duration = 0, reject = false) =>
			toastStore.show({
				type: 'info',
				message: 'Embedded toast',
				...(duration ? { duration } : {}),
				action: {
					label: 'Act',
					onClick: async () => {
						if (reject) throw new Error('Action failed');
						toastClicks++;
					}
				}
			}),
		triggerToast: (id: string) => toastStore.triggerAction(id),
		toastClicks: () => toastClicks,
		externalLinks: async () => {
			const calls: Array<{ kind: string; url: string; target?: string; features?: string }> = [];
			const restore = setExternalURLOpener((url: string) => {
				calls.push({ kind: 'host', url });
			});
			try {
				await openExternalURL('https://example.com/host');
			} finally {
				restore();
			}
			const original = window.open;
			window.open = (url, target, features) => {
				calls.push({ kind: 'browser', url: String(url), target, features });
				return null;
			};
			try {
				await openExternalURL('https://example.com/browser');
			} finally {
				window.open = original;
			}
			return calls;
		}
	}
});
