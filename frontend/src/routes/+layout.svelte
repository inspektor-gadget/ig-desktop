<script lang="js">
	import '../app.css';
	import { setContext } from 'svelte';
	import { goto } from '$app/navigation';

	import Logo from '$lib/components/logo.svelte';
	import BrandIcon from '$lib/icons/ig/small.svg?raw';
	import Gadget from '$lib/icons/gadget.svg?raw';
	import Plus from '$lib/icons/circle-plus.svg?raw';
	import Info from '$lib/icons/info.svg?raw';
	import Book from '$lib/icons/book.svg?raw';
	import Close from '$lib/icons/close-small.svg?raw';
	import Maximize from '$lib/icons/fa/window-maximize.svg?raw';
	import Minimize from '$lib/icons/fa/window-minimize.svg?raw';
	import Restore from '$lib/icons/fa/window-restore.svg?raw';
	import Kubernetes from '$lib/icons/env/kubernetes.svg?raw';
	import ArtifactHub from '$lib/icons/artifacthub-logo.svg?raw';

	import NavbarLink from '$lib/components/navbar-link.svelte';

	let { children } = $props();
	import { appState } from './state.svelte.js';
	import { instances } from '$lib/shared/instances.svelte.js';
	import { environments } from '$lib/shared/environments.svelte.js';

	let version = $state('unknown');
	let connected = $state(false);

	let buffer = [];
	let timer;

	function handler(ev) {
		const msg = JSON.parse(ev);
		if (!msg) return;
		if (msg.data && typeof msg.data === 'object') msg.data.msgID = msgID++;
		switch (msg.type) {
			case 1:
				if (msg.reqID && requests[msg.reqID]) {
					if (!msg.success) {
						requests[msg.reqID].reject(msg.error);
						delete (requests[msg.reqID]);
						return;
					}
					requests[msg.reqID].resolve(msg.data);
					delete (requests[msg.reqID]);
				}
				break;
			case 7: // gadgetPrepare
				console.log('new gadget', msg);
				instances[msg.instanceID] = {
					running: true,
					gadgetInfo: null,
					events: [],
					logs: [],
					environment: msg.environmentID,
					error: null,
				};
				break;
			case 2: // gadgetInfo
				instances[msg.instanceID].gadgetInfo = msg.data;
				break;
			case 3: // gadgetEvent
				buffer.unshift(msg);
				if (!timer) {
					timer = setTimeout(() => {
						timer = null;
						let usedInstances = {};
						buffer.forEach((msg) => {
							instances[msg.instanceID].events.unshift(msg.data);
							usedInstances[msg.instanceID] = true;
						});
						Object.keys(usedInstances).forEach((instanceID) => {
							if (instances[instanceID].events.length > 100) instances[instanceID].events =
								instances[instanceID].events.slice(0, 100);
						})
						buffer = [];
					}, 25);
				}
				break;
			case 4: // logging
				if (instances[msg.instanceID]) {
					instances[msg.instanceID].logs.push(msg.data);
				} else {
					console.log('missed log', msg.data);
				}
				break;
			case 5: // quit
				if (instances[msg.instanceID]) instances[msg.instanceID].running = false;
				break;
			case 6: // gadgetEvent
				instances[msg.instanceID].events = msg.data.map(evt => { evt.msgID = msgID++; return evt; });
				break;
			case 8: // gadgetError
				console.log('gadget error', msg.data);
				instances[msg.instanceID].error = msg.data;
				break;
			case 100: // envCreate
				environments[msg.data.id] = msg.data;
				break;
			case 101:
				delete(environments[msg.data.id]);
				break;
		}
	}

	let reqID = 0;
	let requests = {};
	let msgID = 0;

	let isApp = $state(false)

	let modalError = $state(null);
	function handleError(err) {
		modalError = err;
	}

	let ws;
	if (window.runtime) {
		isApp = true;
		connected = true;
		ws = {
			send: (msg) =>  {
				window.runtime.EventsEmit('server', msg)
			}
		}
		console.log('installing client listener');
		window.runtime.EventsOn('client', (msg) => {
			handler(msg);
		});
		ws.send(JSON.stringify({ cmd: 'helo' })); // handshake with wails
	} else {
		ws = new WebSocket(`ws://${window.location.host}/api/v1/ws`);
		appState.api.setWs(ws);
		ws.addEventListener('error', (ev) => {
			connected = false;
		});
		ws.addEventListener('open', () => {
			connected = true;
		});
		ws.addEventListener('close', () => {
			connected = false;
		});
		ws.addEventListener('message', (ev) => {
			handler(ev.data);
		});
	}

	setContext('api', {
		request(cmd) {
			reqID++;
			cmd.reqID = '' + reqID; // stringify
			const prom = new Promise((resolve, reject) => {
				requests[cmd.reqID] = { resolve, reject };
			});
			ws.send(JSON.stringify(cmd));
			return prom;
		}
	});

	let isMaximized = $state(false);
	async function toggleMaximize() {
		if (isMaximized) {
			isMaximized = false;
			window.runtime.WindowUnmaximise();
		} else {
			isMaximized = true;
			window.runtime.WindowMaximise();
		}
	}

	window.onunhandledrejection = (err) => {
		handleError(err.reason);
	}
</script>
<!--<svelte:window on:error={(err) => { console.log(err); handleError(JSON.stringify(err)) }} />-->
<div class="flex flex-col h-screen">
	{#if isApp}
		<div ondblclick={() => { toggleMaximize() }} style="--wails-draggable: drag"
					class="select-none flex flex-row justify-between bg-gray-950 border-b border-b-gray-800 items-center">
			<div class="flex flex-row gap-2 text-xs text-gray-600 px-2 py-2 uppercase">
				<div>{@html BrandIcon}</div>
				<div>Inspektor Gadget Desktop</div>
			</div>
			<div style="--wails-draggable: no-drag" class="flex flex-row text-gray-600 px-2 py-1 gap-2">
				<div class="hover:text-white" onclick={() => { window.runtime.WindowMinimise() }}>{@html Minimize}</div>
				<div class="hover:text-white"
						 onclick={() => { toggleMaximize() }}>{#if isMaximized}{@html Restore}{:else}{@html Maximize}{/if}</div>
				<div class="hover:text-white" onclick={() => { window.runtime.Quit() }}>{@html Close}</div>
			</div>
		</div>
	{/if}
	{#if connected}
		<div class="flex-1 flex text-gray-100 overflow-hidden">
			<div
				class="flex flex-col justify-between overflow-y-scroll p-3 space-y-2 bg-gray-950 border-r border-r-gray-800 scrollbar-hide">
				<div class="flex flex-col select-none">
					{#if !isApp}
						<a href="https://inspektor-gadget.io" target="_blank">
							<Logo />
						</a>
						<hr class="mx-2 my-4 rounded border-t-2 border-t-white/[.3]" />
					{/if}
					{#each Object.entries(environments) as [id, environment]}
						<NavbarLink href="/env/{id}" title={environment.name}>
							<div class="grid" title={environment.name}>
								<div class="col-start-1 row-start-1 opacity-80 text-gray-600">{@html Gadget}</div>
								<div
									class="col-start-1 row-start-1 flex justify-center text-lg z-10 shadow">{environment.name.substring(0,3)}</div>
							</div>
						</NavbarLink>
					{/each}
<!--					<NavbarLink href="/k">{@html Kubernetes}</NavbarLink>-->
					<NavbarLink href="/environment/create" title="Create environment">{@html Plus}</NavbarLink>
				</div>
				<div class="flex flex-col grow">
				</div>
				<div class="flex flex-col">
					<NavbarLink href="/browse/artifacthub">{@html ArtifactHub}</NavbarLink>
					<NavbarLink href="https://inspektor-gadget.io/docs/latest/" target="_blank">{@html Book}</NavbarLink>
					<NavbarLink href="/info">{@html Info}</NavbarLink>
				</div>
			</div>
			{@render children()}
		</div>
		<div
			class="flex flex-row p-1 px-2 border-t border-t-gray-800 text-xs text-gray-500 bg-gray-950 gap-2 justify-between">
			<div>Connected</div>
			<div>Version {version}</div>
		</div>
	{:else}
		<div class="flex-1 flex text-gray-100 bg-gray-950 items-center justify-center align-middle font-mono">
			Calling the Inspektor...
		</div>
		<div class="p-1 pl-2 border-t border-t-gray-800 text-xs text-gray-500 bg-gray-950" onclick={() => {
			window.location.href = '/';	}}>Disconnected</div>
	{/if}
</div>
{#if modalError}
	<div class="fixed top-0 left-0 w-full h-full flex flex-row justify-between bg-gray-900 text-white z-100">
		<div></div>
		<div class="flex flex-col justify-between max-w-1/3">
			<div></div>
			<div class="flex flex-col bg-gray-950 p-16 rounded-xl gap-8">
				<div class="text-lg text-gray-400">An error occurred</div>
				<div>{modalError}</div>
				<div class="flex flex-row justify-end">
					<button onclick={() => { modalError = null }}
						class="flex flex-row gap-2 py-1 px-2 rounded cursor-pointer bg-red-900 hover:bg-red-800 items-center">Close
					</button>
				</div>
			</div>
			<div></div>
		</div>
		<div></div>
	</div>
{/if}
