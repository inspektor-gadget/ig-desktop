<script>
	import Annotations from '$lib/icons/fa/memo-circle-info.svg?raw';
	import { preferences } from '$lib/shared/preferences.svelte.js';

	let { gadgetInfo } = $props();
</script>

<div class="flex flex-row justify-between gap-2 p-2">
	<div class="">Data Sources</div>
	<button
		title="Toggle annotations"
		class="cursor-pointer"
		class:text-gray-500={!preferences.get('inspector.show-annotations')}
		onclick={() => {
			preferences.set('inspector.show-annotations', !preferences.get('inspector.show-annotations'));
		}}>{@html Annotations}</button
	>
</div>
<ul>
	{#each gadgetInfo.dataSources as ds}
		<li class="">
			<div class="sticky top-0 flex cursor-pointer flex-row bg-gray-950 px-2 py-1">
				<div class="flex-1">{ds.name}</div>
				<!--				<div class="">{@html ChevDown}</div>-->
			</div>
			<div class="flex flex-col gap-1 p-2">
				{#if preferences.get('inspector.show-annotations')}
					{#each ds.annotations as annotation, key}
						<div>A {key}: {annotation}</div>
					{/each}
				{/if}
				{#each ds.fields as field}
					<div class="flex flex-row gap-2">
						<!--						<div class="">{@html Visible}</div>-->
						<div class="flex flex-1 flex-col gap-0.5">
							<div class="font-mono text-sm">{field.name}</div>
							{#if field.annotations?.description}
								<div class="pl-2 text-xs text-gray-400">{field.annotations?.description}</div>
							{/if}
							{#if preferences.get('inspector.show-annotations')}
								<div class="flex flex-col gap-1 pl-2">
									<div class="flex flex-row flex-wrap gap-1 text-xs text-gray-200">
										{#each field.tags as tag}
											<div class="rounded bg-gray-700 px-1 py-0.5">{tag}</div>
										{/each}
									</div>
									<div class="text-xs text-gray-200">
										{#each Object.entries(field.annotations) as [key, annotation] (key)}
											<div>{key}: {annotation}</div>
										{/each}
									</div>
									<div class="flex flex-row flex-wrap gap-1 text-xs text-gray-200">
										{#if (field.flags & 0x01) !== 0}
											<div class="rounded bg-gray-500/60 px-1 py-0.5">empty</div>
										{/if}
										{#if (field.flags & 0x02) !== 0}
											<div class="rounded bg-green-800/60 px-1 py-0.5">container</div>
										{/if}
										{#if (field.flags & 0x04) !== 0}
											<div class="rounded bg-gray-700/60 px-1 py-0.5">hidden</div>
										{/if}
										{#if (field.flags & 0x08) !== 0}
											<div class="rounded bg-blue-800/60 px-1 py-0.5">w-parent</div>
										{/if}
										{#if (field.flags & 0x10) !== 0}
											<div class="rounded bg-orange-800/60 px-1 py-0.5">static</div>
										{/if}
										{#if (field.flags & 0x20) !== 0}
											<div class="rounded bg-red-800/60 px-1 py-0.5">unref</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
						{#if preferences.get('inspector.show-annotations')}
							<div class="rounded pl-1 text-xs">{field.kind || '-'}</div>
						{/if}
					</div>
				{/each}
			</div>
		</li>
	{/each}
</ul>
