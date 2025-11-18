<script lang="ts">
	import { page } from '$app/state';
</script>

<div
	class="flex flex-1 items-center justify-center bg-gray-950 align-middle font-mono text-gray-100"
>
	<div>
		<div class="text-xl">Whoops!</div>
		<div class="text-sm">The Inspektor is confused.</div>
		<div class="mt-4 text-xs text-gray-400">{page.status} {page.error?.message}</div>
	</div>
</div>
