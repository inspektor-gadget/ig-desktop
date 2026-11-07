<script lang="ts">
	import { getContext } from 'svelte';
	import type { ApiContext } from '$lib/types/context';
	import type { FileCaptureStatus } from '$lib/types';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import Stop from '$lib/icons/stop-small.svelte';
	import Copy from '$lib/icons/copy.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import type { FileOutputCapability } from '$lib/types';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { getErrorMessage } from '$lib/utils/errors';
	import { UncertainCommandError } from '$lib/services/api.service.svelte';

	let { instanceID, output }: { instanceID: string; output: FileCaptureStatus } = $props();
	const api = getContext<ApiContext>('api');
	const hostFileOutput = getContext<(() => FileOutputCapability | undefined) | undefined>(
		'fileOutput'
	);
	const terminal = $derived(output.state === 'completed' || output.state === 'failed');
	const size = $derived(
		output.bytes < 1024 * 1024
			? `${output.bytes.toLocaleString()} B`
			: `${(output.bytes / (1024 * 1024)).toFixed(1)} MiB`
	);

	async function copyPath() {
		try {
			if (hostFileOutput?.()?.notify === false) {
				await api.request({ cmd: 'copyFileOutputPath', data: { instanceID } });
				return;
			}
			if (!(await copyToClipboard(output.path))) throw new Error(t('Clipboard unavailable'));
		} catch (err) {
			toastStore.error(
				t('Failed to copy the capture path: {{errorMessage}}', {
					errorMessage: getErrorMessage(err)
				})
			);
		}
	}

	async function stop() {
		try {
			await api.request({ cmd: 'stopInstance', data: { id: instanceID } });
		} catch (err) {
			// A host presenting capture notifications owns retry for uncertain stops.
			if (hostFileOutput?.()?.notify === false && err instanceof UncertainCommandError) return;
			toastStore.error(
				t('Failed to stop the capture: {{errorMessage}}', { errorMessage: getErrorMessage(err) })
			);
		}
	}
</script>

<main class="flex flex-1 flex-col gap-6 overflow-auto bg-ig-surface p-8 text-ig-text">
	<header>
		<h1 class="text-2xl font-semibold">{t('File capture')}</h1>
		<p class="mt-1 text-sm text-ig-text-secondary">
			{t('Status')}: {output.state === 'unknown' ? t('Unknown (connection lost)') : output.state} · {output.format.toUpperCase()}
			· {output.host}
		</p>
	</header>
	<section
		class="grid max-w-2xl gap-4 rounded-ig-lg border border-ig-border bg-ig-surface-raised p-5"
	>
		<div>
			<div class="text-xs font-semibold text-ig-text-muted uppercase">{t('Destination')}</div>
			<div class="mt-1 break-all font-mono text-sm">{output.path}</div>
			{#if output.partialPath}
				<div class="mt-1 break-all text-xs text-ig-text-muted">
					{t('Partial:')}
					{output.partialPath}
				</div>
			{/if}
			{#if output.recoveryPath}
				<div class="mt-1 break-all text-xs text-ig-text-muted">
					{t('Previous file:')}
					{output.recoveryPath}
				</div>
			{/if}
		</div>
		<div class="grid grid-cols-2 gap-4">
			<div>
				<div class="text-xs text-ig-text-muted">{t('Written records')}</div>
				<div class="font-mono">{output.records.toLocaleString()}</div>
			</div>
			<div>
				<div class="text-xs text-ig-text-muted">{t('File size')}</div>
				<div class="font-mono">{size}</div>
			</div>
		</div>
		{#if output.error}<p role="alert" class="text-sm text-ig-error">{output.error}</p>{/if}
		<div class="flex gap-2">
			<button
				onclick={copyPath}
				class="flex items-center gap-1 rounded-ig-sm border border-ig-border-strong px-3 py-2 text-sm hover:bg-ig-border"
			>
				<Copy />
				{t('Copy path')}
			</button>
			{#if !terminal}
				<button
					onclick={stop}
					class="flex items-center gap-1 rounded-ig-sm bg-ig-error px-3 py-2 text-sm text-ig-text-on-primary"
				>
					<Stop />
					{t('Stop')}
				</button>
			{/if}
		</div>
	</section>
</main>
