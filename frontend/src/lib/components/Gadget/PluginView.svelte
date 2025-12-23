<script lang="ts">
	import { mount, unmount, type Component } from 'svelte';
	import type { CompiledPlugin } from '$lib/types/plugin';
	import type { Datasource } from '$lib/types/charts';
	import type { EventRingBuffer } from '$lib/utils/ring-buffer';

	interface Props {
		plugin: CompiledPlugin;
		ds: Datasource;
		events?: EventRingBuffer<Record<string, unknown>>;
		snapshotData?: Record<string, unknown>[];
		eventVersion?: number;
	}

	let { plugin, ds, events, snapshotData, eventVersion = 0 }: Props = $props();

	let container: HTMLDivElement | undefined = $state();
	let mountedInstance: ReturnType<typeof mount> | null = null;

	const eventsArray = $derived(snapshotData ?? events?.toArray() ?? []);

	$effect(() => {
		if (!container || !plugin.exports) {
			return;
		}

		if (mountedInstance) {
			try {
				unmount(mountedInstance);
			} catch (e) {
				console.warn('Error unmounting plugin:', e);
			}
			mountedInstance = null;
		}

		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mountedInstance = mount(plugin.exports as Component<any>, {
				target: container,
				props: {
					ds,
					events: eventsArray,
					eventVersion
				}
			});
		} catch (e) {
			console.error('Error mounting plugin:', e);
		}

		return () => {
			if (mountedInstance) {
				try {
					unmount(mountedInstance);
				} catch (e) {
					console.warn('Error unmounting plugin during cleanup:', e);
				}
				mountedInstance = null;
			}
		};
	});

	$effect(() => {
		if (mountedInstance && typeof (mountedInstance as any).$set === 'function') {
			try {
				(mountedInstance as any).$set({
					ds,
					events: eventsArray,
					eventVersion
				});
			} catch (e) {
				// Component may not support $set
			}
		}
	});

	$effect(() => {
		if (!plugin.css) return;

		const styleId = `plugin-css-${plugin.id}`;
		let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;

		if (!styleEl) {
			styleEl = document.createElement('style');
			styleEl.id = styleId;
			document.head.appendChild(styleEl);
		}

		styleEl.textContent = plugin.css;

		return () => {
			styleEl?.remove();
		};
	});
</script>

<div bind:this={container} class="plugin-view-container h-full w-full overflow-auto">
	<!-- Dynamic plugin component will be mounted here -->
</div>

<style>
	.plugin-view-container {
		min-height: 0;
	}
</style>
