<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/i18n/index.svelte';
</script>

<div
	class="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950 align-middle font-mono text-gray-900 dark:text-gray-100"
>
	<div>
		<div class="text-xl">{t('Whoops!')}</div>
		<div class="text-sm">{t('The Inspektor is confused.')}</div>
		<div class="mt-4 text-xs text-gray-600 dark:text-gray-400">
			{page.status}
			{page.error?.message}
		</div>
	</div>
</div>
