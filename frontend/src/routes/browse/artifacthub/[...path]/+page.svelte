<script>
	import { marked } from 'marked';
	import { getContext } from 'svelte';
	import { Browser } from '@wailsio/runtime';
	import ArtifactHub from '$lib/icons/artifacthub.svg?raw';
	import Play from '$lib/icons/play-circle.svg?raw';
	import ChevronLeft from '$lib/icons/chevron-left.svg?raw';
	import Spinner from '$lib/components/Spinner.svelte';

	let { data } = $props();

	const api = getContext('api');

	let pkg = $state(null);

	// Configure marked to intercept links and open them externally via Wails
	const renderer = new marked.Renderer();
	renderer.link = function ({ href, title, tokens }) {
		// Sanitize and encode the href to prevent XSS
		const sanitizedHref = href
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');

		// Sanitize title if present
		const sanitizedTitle = title
			? title
					.replace(/&/g, '&amp;')
					.replace(/"/g, '&quot;')
					.replace(/'/g, '&#39;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
			: '';

		const titleAttr = sanitizedTitle ? ` title="${sanitizedTitle}"` : '';

		// Use marked's built-in parser to safely render the link text
		const text = this.parser.parseInline(tokens);

		return `<a href="#" data-external-link="${sanitizedHref}"${titleAttr} class="external-link">${text}</a>`;
	};

	marked.setOptions({
		renderer: renderer,
		// Enable security options
		sanitize: false, // We're handling sanitization ourselves
		mangle: false
	});

	// Handle clicks on external links
	function handleLinkClick(event) {
		const target = event.target.closest('[data-external-link]');
		if (target) {
			event.preventDefault();
			const url = target.getAttribute('data-external-link');
			if (url) {
				// Validate URL before opening
				try {
					const urlObj = new URL(url);
					// Only allow http and https protocols
					if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
						Browser.OpenURL(url);
					} else {
						console.warn('Blocked non-HTTP(S) URL:', url);
					}
				} catch (e) {
					console.error('Invalid URL:', url, e);
				}
			}
		}
	}

	async function loadPackage() {
		const elems = data.url.split('/');
		const res = await api.request({
			cmd: 'getArtifactHubPackage',
			data: { repository: elems[0], package: elems[1], version: elems[2] }
		});
		pkg = res.data;
	}

	loadPackage();
</script>

{#if !pkg}
	<div
		class="flex flex-1 items-center justify-center bg-gray-950 align-middle font-mono text-gray-100"
	>
		<div class="flex flex-col items-center gap-4">
			<Spinner />
			<div>
				<div class="text-xl">Loading...</div>
				<div class="text-sm">The Inspektor is doing some research on ArtifactHub.</div>
			</div>
		</div>
	</div>
{:else}
	<div class="flex flex-row justify-between bg-gray-950 p-4">
		<div class="flex flex-row items-center gap-4">
			<button
				onclick={() => history.back()}
				class="flex cursor-pointer items-center rounded bg-gray-800 p-1.5 hover:bg-gray-700"
				title="Go back"
			>
				{@html ChevronLeft}
			</button>
			<div class="flex flex-col">
				<div class="text-xl">{pkg.name}</div>
				<div class="text-xs">
					<span class="text-gray-400">by</span>
					{pkg.repository?.organization_display_name || pkg.repository?.user_alias}
				</div>
			</div>
		</div>
		<div class="flex flex-col">
			<div class="text-right text-xs">powered by</div>
			<div>{@html ArtifactHub}</div>
		</div>
	</div>
	<div class="flex flex-row overflow-hidden">
		<div class="flex w-2/3 flex-col">
			<div class="marked flex flex-col overflow-hidden p-4">
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					role="article"
					aria-label="Package readme"
					class="overflow-auto rounded bg-gray-800 p-4 whitespace-pre-wrap"
					onclick={handleLinkClick}
				>
					{@html marked(pkg.readme || '')}
				</div>
			</div>
		</div>
		<div class="w-1/3 p-4 pl-0">
			<div class="flex flex-col gap-4 rounded bg-gray-950 p-4">
				<div>Images</div>
				{#each pkg.containers_images as image}
					<a href="/gadgets/run/{image.image}">
						<div
							class="flex flex-row flex-wrap justify-between gap-2 rounded bg-green-800 p-2 hover:bg-green-700"
						>
							<div class="flex flex-row gap-2">
								<div>{@html Play}</div>
								<div>{image.name}</div>
							</div>
							<div class="flex flex-row flex-wrap gap-1">
								{#each image.platforms as platform}
									<div class="rounded bg-gray-900 px-2 py-1 text-xs">{platform}</div>
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

			a.external-link {
				color: #60a5fa;
				text-decoration: underline;
				cursor: pointer;
			}

			a.external-link:hover {
				color: #93c5fd;
			}
		}
	}
</style>
