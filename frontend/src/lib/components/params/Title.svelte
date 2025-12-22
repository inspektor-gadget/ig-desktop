<script lang="ts">
	interface Param {
		key: string;
		title?: string;
		description?: string;
	}

	interface Props {
		param: Param;
		onclick?: ((e: MouseEvent) => void) | undefined;
	}

	let { param, onclick = $bindable() }: Props = $props();
</script>

{#snippet content()}
	<div>{param.title || param.key}</div>
	{#if param.description}
		<div
			class="mb-2 max-h-24 overflow-hidden text-xs overflow-ellipsis whitespace-pre-wrap text-gray-500 dark:text-gray-500"
		>
			{param.description}
		</div>
	{/if}
{/snippet}

{#if onclick}
	<div
		class="flex flex-col gap-1 cursor-pointer"
		{onclick}
		onkeydown={(e) => e.key === 'Enter' && onclick?.(e as unknown as MouseEvent)}
		role="button"
		tabindex="0"
	>
		{@render content()}
	</div>
{:else}
	<div class="flex flex-col gap-1">
		{@render content()}
	</div>
{/if}
