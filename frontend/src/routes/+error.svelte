<script lang="ts">
	import { page } from '$app/state';
</script>
<div class="flex-1 flex text-gray-100 bg-gray-950 items-center justify-center align-middle font-mono">
	<div>
		<div class="text-xl">Whoops!</div>
		<div class="text-sm">The Inspektor is confused.</div>
		<div class="text-xs mt-4 text-gray-400">{page.status} {page.error?.message}</div>
	</div>
</div>
