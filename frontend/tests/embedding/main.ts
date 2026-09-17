import { mount } from 'svelte';
import type { EmbeddableAppProps, EmbeddableAppState } from '../../src/lib/types/embedding';
// Load the production artifact at runtime; do not typecheck generated/minified JS.
const libraryPath = '../../build-embedding/ig-frontend.js';
const { EmbeddableApp, initializeIG, createReactiveProps, apiService, toastStore } = await import(
	/* @vite-ignore */ libraryPath
);
import '../../build-embedding/ig-frontend.css';

const environment = { id: 'test-env', name: 'Embedding environment', runtime: 'grpc', params: {} };
const gadgetInfo = {
	imageName: 'test/image:latest',
	params: [{ key: 'pid', title: 'PID', type: 'uint32', defaultValue: '0' }],
	dataSources: [
		{
			name: 'events',
			fields: [{ name: 'comm', fullName: 'comm', kind: 'String', flags: 0, annotations: {} }],
			annotations: { 'metrics.collect': 'true' }
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
			initialResultVisible: boolean;
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
		let data: unknown = {};
		switch (request.cmd) {
			case 'getGadgetInfo':
				data = gadgetInfo;
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
				metadata('manual-run');
				data = { id: 'manual-run' };
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
	onNavigate: (path: string) => {
		props.path = path;
	},
	onStateChange: (state: EmbeddableAppState) => {
		states.push(state);
		props.path = state.path;
	}
});
mount(EmbeddableApp, { target: document.getElementById('app')!, props });
Object.assign(window, {
	embedding: {
		requests,
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
		toastClicks: () => toastClicks
	}
});
