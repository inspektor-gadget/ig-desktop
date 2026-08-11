<script lang="ts">
	import type { NetworkNamespaceGroupData } from '$lib/types/networkmap';

	interface Props {
		data: NetworkNamespaceGroupData;
	}
	let { data }: Props = $props();
</script>

<div
	class="relative h-full w-full rounded-ig-lg border-2 border-dashed border-ig-border bg-ig-surface-raised"
>
	<div
		class="absolute top-1 left-2 rounded-ig-sm bg-ig-surface px-2 py-0.5 text-[11px] font-semibold tracking-wide text-ig-text-secondary uppercase"
	>
		{data.label}
	</div>
</div>
