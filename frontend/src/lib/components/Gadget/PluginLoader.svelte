<script lang="ts">
	import BaseModal from '../BaseModal.svelte';
	import Button from '../Button.svelte';
	import { pluginService } from '$lib/services/plugin.service';
	import type { PluginBundle, CompiledPlugin } from '$lib/types/plugin';
	import { getPluginEntrypoint } from '$lib/types/plugin';
	import WarningIcon from '$lib/icons/warning.svg?raw';

	interface Props {
		/** The plugin bundle to load */
		bundle: PluginBundle;
		/** Called when the plugin is successfully compiled and loaded */
		onLoaded: (plugin: CompiledPlugin) => void;
		/** Called when the user rejects loading the plugin */
		onRejected: () => void;
		/** Called when the modal is closed (via backdrop or X button) */
		onClose?: () => void;
	}

	let { bundle, onLoaded, onRejected, onClose }: Props = $props();

	let open = $state(true);
	let showPreview = $state(false);
	let selectedFile = $state<string | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	const fileList = $derived(Object.keys(bundle.files).sort());
	const fileCount = $derived(fileList.length);
	const entrypoint = $derived(getPluginEntrypoint(bundle));
	const totalSize = $derived(
		Object.values(bundle.files).reduce((sum, content) => sum + content.length, 0)
	);

	function togglePreview() {
		showPreview = !showPreview;
		if (showPreview && !selectedFile) {
			selectedFile = entrypoint;
		}
	}

	async function handleApprove() {
		isLoading = true;
		error = null;

		try {
			const compiled = await pluginService.compile(bundle);
			open = false;
			onLoaded(compiled);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Compilation failed';
			console.error('Plugin compilation error:', e);
		} finally {
			isLoading = false;
		}
	}

	function handleReject() {
		open = false;
		onRejected();
	}

	function handleClose() {
		open = false;
		onClose?.();
	}
</script>

<BaseModal bind:open title="Custom Plugin" size="lg" onClose={handleClose}>
	<div class="space-y-4">
		<!-- Security Warning -->
		<div class="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
			<div class="flex-shrink-0 text-amber-500">
				{@html WarningIcon}
			</div>
			<div>
				<h3 class="font-semibold text-amber-400">Security Notice</h3>
				<p class="mt-1 text-sm text-amber-300/90">
					This gadget includes a custom plugin with {fileCount} file{fileCount === 1 ? '' : 's'}.
					Plugins can execute JavaScript code in your browser. Only approve plugins from sources you
					trust.
				</p>
			</div>
		</div>

		<!-- Plugin Info -->
		<div
			class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4"
		>
			<div class="flex items-center justify-between">
				<div>
					<h4 class="font-medium text-gray-900 dark:text-gray-100">
						{bundle.name}
					</h4>
					<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
						{fileCount} file{fileCount === 1 ? '' : 's'} &middot; {(totalSize / 1024).toFixed(1)} KB
						&middot; Entry: {entrypoint}
					</p>
				</div>
				<button
					onclick={togglePreview}
					class="text-sm font-medium text-blue-500 hover:text-blue-400 transition-colors"
				>
					{showPreview ? 'Hide' : 'Preview'} source
				</button>
			</div>
		</div>

		<!-- Source Code Preview -->
		{#if showPreview}
			<div class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
				<!-- File tabs -->
				<div
					class="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2 py-1 overflow-x-auto"
				>
					{#each fileList as file}
						<button
							onclick={() => (selectedFile = file)}
							class="px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap {selectedFile ===
							file
								? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
								: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}"
						>
							{file}
							{#if file === entrypoint}
								<span class="ml-1 text-blue-500">(entry)</span>
							{/if}
						</button>
					{/each}
				</div>

				<!-- File content -->
				{#if selectedFile && bundle.files[selectedFile]}
					<div
						class="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 px-4 py-2"
					>
						<span class="text-xs font-medium text-gray-500 dark:text-gray-400">
							{selectedFile} ({bundle.files[selectedFile].length} characters)
						</span>
						<button
							onclick={() => selectedFile && navigator.clipboard.writeText(bundle.files[selectedFile])}
							class="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
						>
							Copy
						</button>
					</div>
					<pre class="max-h-64 overflow-auto bg-gray-900 p-4 text-sm text-gray-300"><code
							>{bundle.files[selectedFile]}</code
						></pre>
				{/if}
			</div>
		{/if}

		<!-- Error Display -->
		{#if error}
			<div class="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-red-400">
				<h4 class="font-semibold">Compilation Error</h4>
				<pre class="mt-2 text-sm whitespace-pre-wrap">{error}</pre>
			</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={handleReject} disabled={isLoading}>Reject</Button>
		<Button variant="primary" onclick={handleApprove} loading={isLoading}>
			{isLoading ? 'Compiling...' : 'Approve & Load'}
		</Button>
	{/snippet}
</BaseModal>
