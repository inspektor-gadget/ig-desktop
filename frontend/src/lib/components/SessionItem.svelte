<script lang="ts">
	import type { SessionItem } from '$lib/types';
	import { formatAbsoluteTime, formatRelativeTime } from '$lib/utils/time';
	import Trash from '$lib/icons/fa/trash.svg?raw';

	interface Props {
		session: SessionItem;
		onDelete?: () => void;
	}

	let { session, onDelete }: Props = $props();
</script>

<div
	class="group/item rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/50 dark:bg-gray-900/50 p-4 transition-all hover:border-green-500/50 hover:bg-gray-100 dark:hover:bg-gray-900"
>
	<div class="flex flex-row items-start justify-between gap-4">
		<a
			href="/sessions/{session.id}?highlightEnvironment={session.environmentId}"
			class="flex flex-1 flex-col gap-2"
		>
			<div class="flex flex-row items-center gap-2">
				<span class="font-medium text-gray-800 dark:text-gray-200"
					>{session.name || 'Unnamed Session'}</span
				>
				<span class="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-600 dark:text-green-400"
					>{session.runCount} {session.runCount === 1 ? 'run' : 'runs'}</span
				>
			</div>
			<div class="flex flex-row items-center gap-2 text-xs text-gray-500">
				<span class="cursor-help" title={formatAbsoluteTime(session.createdAt)}
					>Created {formatRelativeTime(session.createdAt)}</span
				>
				{#if session.updatedAt !== session.createdAt}
					<span>•</span>
					<span class="cursor-help" title={formatAbsoluteTime(session.updatedAt)}
						>Updated {formatRelativeTime(session.updatedAt)}</span
					>
				{/if}
			</div>
		</a>
		<button
			onclick={() => onDelete?.()}
			class="cursor-pointer rounded p-1.5 text-gray-500 transition-all hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-red-400"
			title="Delete session">{@html Trash}</button
		>
	</div>
</div>
