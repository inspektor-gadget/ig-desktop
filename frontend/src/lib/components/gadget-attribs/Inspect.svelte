<script lang="ts">
	import { getContext } from 'svelte';
	import type { GadgetContext } from '$lib/types';
	import { t } from '$lib/i18n/index.svelte';

	const gadget = getContext<GadgetContext>('gadget');

	let inspect = $derived(gadget.inspect);
</script>

<div class="flex flex-1 text-sm">
	{#if inspect}
		<table class="w-full max-w-full border-b border-ig-border">
			<thead class="sticky top-0">
				<tr class="bg-ig-surface text-xs uppercase">
					<th class="border-r border-ig-border p-2 font-normal">{t('Key')}</th>
					<th class="p-2 font-normal">{t('Value')}</th>
				</tr>
			</thead>
			<tbody>
				{#each inspect.fields as field (field.fullName)}
					<tr>
						<td class="border-r border-ig-border px-2 py-1 text-ig-text-secondary"
							>{field.fullName}</td
						>
						<td class="px-2 py-1 text-nowrap overflow-ellipsis">{inspect.entry[field.fullName]}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<div class="flex flex-1 items-center justify-center align-middle">
			<div>{t('No node selected.')}</div>
		</div>
	{/if}
</div>
