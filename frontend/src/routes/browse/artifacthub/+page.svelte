<script>
	import ArtifactHub from '$lib/icons/artifacthub.svg?raw';
	import Signed from '$lib/icons/signature-locked.svg?raw';
	import Unsigned from '$lib/icons/signature-slash.svg?raw';
	import Play from '$lib/icons/play-circle.svg?raw';
	import Link from '$lib/icons/href.svg?raw';
	import Star from '$lib/icons/star-sharp.svg?raw';

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

	let results = $derived(!search ? list : list.filter((e) => {
		return e.name.toLowerCase().includes(search) ||
			e.description.toLowerCase().includes(search);
	}));

	async function getList() {
		const result = await
			fetch('https://artifacthub.io/api/v1/packages/search?offset=0&limit=60&facets=true&kind=22&deprecated=false&sort=relevance', {
				mode: 'cors'
			});
		const data = await result.json();
		list = data.packages;
	}

	getList();
</script>

<div class="flex flex-col shadow-lg z-1">
	<div class="p-4 flex flex-row justify-between bg-gray-950">
		<div class="text-xl">Gadget Gallery</div>
		<div class="flex flex-col">
			<div class="text-xs text-right">powered by</div>
			<div>{@html ArtifactHub}</div>
		</div>
	</div>
	<div class="p-4 flex flex-row justify-between bg-gray-800">
		<div></div>
		<div><input bind:value={search} class="rounded text-sm bg-gray-900 p-1" type="search" /></div>
	</div>
</div>
<div class="grid grid-cols-4 gap-4 overflow-auto p-4">
	{#each results as entry}
		<div class="flex flex-col bg-gray-800 p-4 rounded relative justify-between gap-2">
			{#if entry.official}
				<div class="ribbon-official text-xs">Official</div>
			{/if}
			<div>
				<div><a href="artifacthub/{entry.repository.name}/{entry.normalized_name}/{entry.version}">{entry.name}</a><span
					class="text-xs text-gray-400 ml-1">{entry.version}</span></div>
				<div class="text-xs"><span class="text-xs text-gray-400 mr-1">by
				</span>{entry.repository.organization_display_name || entry.repository.user_alias}</div>
				<div class="text-xs text-gray-400 py-2 text-ellipsis overflow-hidden">{entry.description}</div>
			</div>
			<div class="flex flex-col gap-2">
				<div class="flex flex-row flex-wrap gap-2">
					<a class="flex flex-row gap-1 text-xs hover:text-white text-gray-400"
						 target="_blank" href="https://artifacthub.io/packages/inspektor-gadget/{entry.repository.name}/
				{entry.normalized_name}"><span
						class="w-2 h-2">{@html Link}</span><span>ArtifactHub
				</span></a>
					<a class="flex flex-row gap-1 text-xs hover:text-white text-gray-400"
						 target="_blank" href={entry.repository.url}><span
						class="w-2 h-2">{@html Link}</span><span>Repository
				</span></a>
				</div>
				<div class="flex flex-row justify-between items-center">
					<div class="flex flex-row gap-4">
						<div>
							{#if entry.signed}
								<div title="Signed">{@html Signed}</div>
							{:else}
								<div title="Not Signed">{@html
									Unsigned}</div>
							{/if}
						</div>
						<div
							class="flex flex-row gap-1 items-center">
							<div title="Stars">{@html Star}</div>
							<div
								class="text-xs">{entry.stars}</div>
						</div>
					</div>
					<div class="flex flex-row gap-2">
						<div><a
							class="hover:text-white text-gray-400"
							title="Run Gadget"
							href="artifacthub/{entry.repository.name}/{entry.normalized_name}/{entry.version}">{@html Play}</a></div>
					</div>
				</div>
			</div>
		</div>
	{/each}
</div>

<style>
    .ribbon-official {
        --f: 10px; /* control the folded part*/
        --r: 8px; /* control the ribbon shape */
        --t: 10px; /* the top offset */

        position: absolute;
        inset: var(--t) calc(-1 * var(--f)) auto auto;
        padding: 0 10px var(--f) calc(10px + var(--r));
        clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--f)), calc(100% - var(--f)) 100%,
        calc(100% - var(--f)) calc(100% - var(--f)), 0 calc(100% - var(--f)),
        var(--r) calc(50% - var(--f) / 2));
        background: #BD1550;
        box-shadow: 0 calc(-1 * var(--f)) 0 inset #0005;
    }
</style>
