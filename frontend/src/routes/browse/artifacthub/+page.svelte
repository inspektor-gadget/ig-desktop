<script>
	import ArtifactHub from '$lib/icons/artifacthub.svg?raw';
	import Signed from '$lib/icons/signature-locked.svg?raw';
	import Unsigned from '$lib/icons/signature-slash.svg?raw';
	import Play from '$lib/icons/play-circle.svg?raw';
	import Link from '$lib/icons/href.svg?raw';
	import Star from '$lib/icons/star-sharp.svg?raw';
	import Spinner from '$lib/components/Spinner.svelte';
	import ChevronLeft from '$lib/icons/chevron-left.svg?raw';
	import Search from '$lib/icons/search-small.svg?raw';

	// {
	// 		"package_id": "e36de540-4772-4761-a321-f8936e73dc53",
	// 		"name": "fdpass",
	// 		"normalized_name": "fdpass",
	// 		"category": 4,
	// 		"logo_image_id": "5ee48b53-35a5-4afa-adb7-5bcac28ee2ef",
	// 		"stars": 0,
	// 		"official": true,
	// 		"cncf": true,
	// 		"display_name": "fdpass",
	// 		"description": "Trace file descriptor passing via a unix socket (SCM_RIGHTS)",
	// 		"version": "0.36.0",
	// 		"deprecated": false,
	// 		"has_values_schema": false,
	// 		"signed": true,
	// 		"signatures": [
	// 			"cosign"
	// 		],
	// 		"all_containers_images_whitelisted": false,
	// 		"production_organizations_count": 0,
	// 		"ts": 1736155145,
	// 		"repository": {
	// 			"url": "https://github.com/inspektor-gadget/inspektor-gadget/",
	// 			"kind": 22,
	// 			"name": "gadgets",
	// 			"official": false,
	// 			"display_name": "Official gadgets",
	// 			"repository_id": "5f918783-a578-4873-8637-52c7ed102fc9",
	// 			"scanner_disabled": false,
	// 			"organization_name": "inspektor-gadget",
	// 			"verified_publisher": true,
	// 			"organization_display_name": "Inspektor Gadget"
	// 		}
	// }

	let search = $state('');
	let list = $state([]);
	let isLoading = $state(true);

	let results = $derived(
		!search
			? list
			: list.filter((e) => {
					return (
						e.name.toLowerCase().includes(search) || e.description.toLowerCase().includes(search)
					);
				})
	);

	async function getList() {
		isLoading = true;
		const result = await fetch(
			'https://artifacthub.io/api/v1/packages/search?offset=0&limit=60&facets=true&kind=22&deprecated=false&sort=relevance',
			{
				mode: 'cors'
			}
		);
		const data = await result.json();
		list = data.packages;
		isLoading = false;
	}

	getList();
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="z-1 flex flex-col shadow-lg">
		<div class="flex flex-row justify-between bg-gray-950 p-4">
			<div class="flex flex-row items-center gap-4">
				<button
					onclick={() => history.back()}
					class="flex cursor-pointer items-center rounded bg-gray-800 p-1.5 hover:bg-gray-700"
					title="Go back"
				>
					{@html ChevronLeft}
				</button>
				<div class="text-xl">Gadget Gallery</div>
			</div>
			<div class="flex flex-col">
				<div class="text-right text-xs">powered by</div>
				<div>{@html ArtifactHub}</div>
			</div>
		</div>
		<div class="flex flex-row justify-between bg-gray-800 p-4">
			<div></div>
			<div class="relative">
				<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
					<span class="h-4 w-4 text-gray-400">{@html Search}</span>
				</div>
				<input
					bind:value={search}
					class="w-64 rounded-lg border border-gray-700 bg-gray-900 py-2 pr-4 pl-10 text-sm placeholder-gray-500 transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
					type="search"
					placeholder="Search gadgets..."
				/>
			</div>
		</div>
	</div>
	{#if isLoading}
		<div class="flex flex-1 items-center justify-center">
			<div class="flex flex-col items-center gap-4">
				<Spinner />
				<div class="text-center">
					<div class="text-xl">Loading gadgets...</div>
					<div class="text-sm text-gray-400">Fetching packages from ArtifactHub</div>
				</div>
			</div>
		</div>
	{:else if results.length > 0}
		<div class="grid flex-1 grid-cols-4 gap-4 overflow-auto p-4">
			{#each results as entry}
				<a
					href="artifacthub/{entry.repository.name}/{entry.normalized_name}/{entry.version}"
					class="group relative flex flex-col justify-between gap-2 rounded-xl border border-gray-800 bg-gray-950 p-4 transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10"
				>
					{#if entry.official}
						<div class="ribbon-official text-xs">Official</div>
					{/if}
					<div>
						<div>
							<span class="font-medium text-gray-200">{entry.name}</span><span
								class="ml-1 text-xs text-gray-400">{entry.version}</span
							>
						</div>
						<div class="text-xs">
							<span class="mr-1 text-xs text-gray-400">by </span>{entry.repository
								.organization_display_name || entry.repository.user_alias}
						</div>
						<div class="overflow-hidden py-2 text-xs text-ellipsis text-gray-400">
							{entry.description}
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<div class="flex flex-row flex-wrap gap-2">
							<span
								class="flex flex-row gap-1 text-xs text-gray-400 transition-colors"
								title="View on ArtifactHub"
								><span class="h-2 w-2">{@html Link}</span><span>ArtifactHub </span></span
							>
							<span
								class="flex flex-row gap-1 text-xs text-gray-400 transition-colors"
								title="View Repository"
								><span class="h-2 w-2">{@html Link}</span><span>Repository </span></span
							>
						</div>
						<div class="flex flex-row items-center justify-between">
							<div class="flex flex-row gap-4">
								<div>
									{#if entry.signed}
										<div title="Signed" class="text-gray-400">{@html Signed}</div>
									{:else}
										<div title="Not Signed" class="text-gray-400">{@html Unsigned}</div>
									{/if}
								</div>
								<div class="flex flex-row items-center gap-1">
									<div title="Stars" class="text-gray-400">{@html Star}</div>
									<div class="text-xs text-gray-400">{entry.stars}</div>
								</div>
							</div>
							<div class="flex flex-row gap-2">
								<div
									class="text-gray-400 transition-colors group-hover:text-blue-400"
									title="Run Gadget"
								>
									{@html Play}
								</div>
							</div>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{:else}
		<div class="flex flex-1 items-center justify-center">
			<div class="text-center">
				<div class="text-xl">No gadgets found</div>
				<div class="text-sm text-gray-400">
					{#if search}
						No gadgets match your search term "{search}"
					{:else}
						No gadgets available
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.ribbon-official {
		--f: 10px; /* control the folded part*/
		--r: 8px; /* control the ribbon shape */
		--t: 10px; /* the top offset */

		position: absolute;
		inset: var(--t) calc(-1 * var(--f)) auto auto;
		padding: 0 10px var(--f) calc(10px + var(--r));
		clip-path: polygon(
			0 0,
			100% 0,
			100% calc(100% - var(--f)),
			calc(100% - var(--f)) 100%,
			calc(100% - var(--f)) calc(100% - var(--f)),
			0 calc(100% - var(--f)),
			var(--r) calc(50% - var(--f) / 2)
		);
		background: #bd1550;
		box-shadow: 0 calc(-1 * var(--f)) 0 inset #0005;
	}
</style>
