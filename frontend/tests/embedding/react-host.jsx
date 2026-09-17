// @ts-nocheck -- Optional React peers are supplied by IG_REACT_MODULES for this browser-only fixture.
import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IGProvider } from '@fixture/provider';
import { SvelteWrapper } from '@fixture/wrapper';
import { EmbeddableApp } from '@inspektor-gadget/frontend';

export function mountReact({ adapter, initialPath, states }) {
	const restored = new URLSearchParams(location.search).has('restored');
	const viewState = restored ? { search: '', visualizers: { events: 'table' } } : undefined;
	function Host() {
		const [path, setPath] = useState(initialPath);
		const [desiredView, setDesiredView] = useState(viewState);
		const [, setApplied] = useState('');
		window.embedding.update = (next) => {
			if (next.path !== undefined) setPath(next.path);
			if ('viewState' in next) setDesiredView(next.viewState);
		};
		const onStateChange = useCallback((state) => {
			states.push(state);
			setPath(state.path);
			setApplied(JSON.stringify(state));
		}, []);
		const props = { path, onStateChange, viewState: desiredView };
		return (
			<IGProvider adapter={adapter} language="en">
				<SvelteWrapper component={EmbeddableApp} {...props} />
			</IGProvider>
		);
	}
	createRoot(document.getElementById('app')).render(<Host />);
}

let receive = () => {};
let connection = () => {};
const states = [];
const requests = [];
const adapter = {
	connected: false,
	async connect() {
		this.connected = true;
		connection(true);
	},
	onMessage(handler) {
		receive = handler;
	},
	onConnectionChange(handler) {
		connection = handler;
	},
	disconnect() {
		this.connected = false;
		connection(false);
	},
	send(message) {
		const request = JSON.parse(message);
		requests.push(request);
		const emit = (event) => receive(JSON.stringify(event));
		if (request.cmd !== 'helo') {
			emit({
				type: 1,
				reqID: request.reqID,
				success: true,
				data:
					request.cmd === 'getRuntimes'
						? [{ key: 'grpc', title: 'Host', description: 'Remote daemon' }]
						: []
			});
			return;
		}
		emit({ type: 100, data: { id: 'test-env', name: 'Embedding environment', runtime: 'grpc' } });
		const seed = () => {
			emit({
				type: 2,
				instanceID: 'run-one',
				environmentID: 'test-env',
				data: {
					imageName: 'test/image:latest',
					dataSources: [
						{
							name: 'events',
							fields: [
								{ name: 'comm', fullName: 'comm', kind: 'String', flags: 0, annotations: {} }
							],
							annotations: { 'metrics.collect': 'true' }
						}
					]
				}
			});
			emit({ type: 6, instanceID: 'run-one', datasourceID: 'events', data: [{ comm: 'alpha' }] });
		};
		if (new URLSearchParams(location.search).has('restored')) {
			const delay = Number(new URLSearchParams(location.search).get('metadataDelay') ?? 100);
			if (delay === -1) seed();
			else if (delay === -2) queueMicrotask(seed);
			else setTimeout(seed, delay);
		} else seed();
	}
};
window.embedding = { states, requests };
mountReact({
	adapter,
	states,
	initialPath: new URLSearchParams(location.search).get('initialPath')
});
