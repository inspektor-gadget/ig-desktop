<script>
	import { marked } from 'marked';
	import { getContext } from 'svelte';
	import ArtifactHub from '$lib/icons/artifacthub.svg?raw';
	import Play from '$lib/icons/play-circle.svg?raw';

	let { data } = $props();

	const api = getContext('api');

	let pkg = $state(null);

	async function loadPackage() {
		const elems = data.url.split('/');
		const res = await api.request({
			cmd: 'getArtifactHubPackage',
			data: { repository: elems[0], package: elems[1], version: elems[2] }
		});
		console.log(res);
		pkg = res.data;
	}

	loadPackage();
</script>

{#if !pkg}
	<div class="flex-1 flex text-gray-100 bg-gray-950 items-center justify-center align-middle font-mono">
		<div>
			<div class="text-xl">Loading...</div>
			<div class="text-sm">The Inspektor is doing some research on ArtifactHub.</div>
		</div>
	</div>
{:else}
	<div class="p-4 flex flex-row justify-between bg-gray-950">
		<div class="flex flex-col">
			<div class="text-xl">{pkg.name}</div>
			<div
				class="text-xs"><span class="text-gray-400">by</span>
				{pkg.repository?.organization_display_name || pkg.repository?.user_alias}</div>
		</div>
		<div class="flex flex-col">
			<div class="text-xs text-right">powered by</div>
			<div>{@html ArtifactHub}</div>
		</div>
	</div>
	<div class="flex flex-row overflow-hidden">
		<div
			class="w-2/3 flex flex-col">
			<div
				class="flex flex-col p-4 marked overflow-hidden">
				<div
					class="p-4 bg-gray-800 rounded whitespace-pre-wrap overflow-auto">{@html marked(pkg.readme || '')}</div>
			</div>
		</div>
		<div class="w-1/3 p-4 pl-0">
			<div class="flex flex-col bg-gray-950 p-4 rounded gap-4">
				<div>Images</div>
				{#each pkg.containers_images as image}
					<a href="/gadgets/run/{image.image}">
						<div class="flex flex-row flex-wrap gap-2 justify-between p-2 bg-green-800 hover:bg-green-700 rounded">
							<div class="flex flex-row gap-2">
								<div>{@html Play}</div>
								<div>{image.name}</div>
							</div>
							<div class="flex flex-row gap-1 flex-wrap">
								{#each image.platforms as platform}
									<div class="bg-gray-900 rounded px-2 py-1 text-xs">{platform}</div>
								{/each}
							</div>
						</div>
					</a>
				{/each}
			</div>
		</div>
	</div>
	<!--<div>{JSON.stringify(pkg)}</div>-->
{/if}

<style>
    :global {
        .marked {
            h1 {
                font-size: 2rem;
            }

            h2 {
                font-size: 1.5rem;
            }

            code {
                background-color: var(--color-gray-950);
                padding: var(--spacing);
                border-radius: var(--radius-sm);
            }
        }
    }
</style>
