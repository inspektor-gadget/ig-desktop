<script>
	import { marked } from 'marked';
	import { getContext } from 'svelte';
	import { Browser } from '@wailsio/runtime';
	import Panel from '$lib/components/Panel.svelte';
	import ArtifactHub from '$lib/icons/artifacthub.svg?raw';
	import Play from '$lib/icons/play-circle.svg?raw';
	import ChevronLeft from '$lib/icons/chevron-left.svg?raw';
	import Book from '$lib/icons/book.svg?raw';
	import Code from '$lib/icons/code.svg?raw';
	import Spinner from '$lib/components/Spinner.svelte';
	import Signed from '$lib/icons/signature-locked.svg?raw';
	import Unsigned from '$lib/icons/signature-slash.svg?raw';
	import Star from '$lib/icons/star-sharp.svg?raw';
	import Link from '$lib/icons/href.svg?raw';
	import { page } from '$app/state';

	let { data } = $props();

	const api = getContext('api');

	let environmentID = $derived(page.url.searchParams.get('env') || '');

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
	<div class="flex flex-row justify-between bg-gray-950 p-4 shadow-lg">
		<div class="flex flex-row items-center gap-4">
			<button
				onclick={() => history.back()}
				class="flex cursor-pointer items-center rounded bg-gray-800 p-1.5 hover:bg-gray-700"
				title="Go back"
			>
				{@html ChevronLeft}
			</button>
		</div>
		<div class="flex flex-col">
			<div class="text-right text-xs">powered by</div>
			<div>{@html ArtifactHub}</div>
		</div>
	</div>
	<div class="flex grow flex-col overflow-auto bg-gray-950/80 p-8">
		<div class="mx-auto flex w-full max-w-7xl flex-col gap-6">
			<!-- Hero Section -->
			<div
				class="relative overflow-hidden rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-950 to-gray-900 p-8 shadow-lg shadow-gray-950/50"
			>
				<!-- Decorative gradient overlay -->
				<div
					class="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-pink-500/5"
				></div>

				<div class="relative z-10 flex flex-col gap-6">
					<!-- Title and badges -->
					<div class="flex flex-col gap-3">
						<div class="flex flex-wrap items-center gap-3">
							<h1 class="text-4xl font-bold text-white">
								{pkg.name}
							</h1>
							<span class="rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-400"
								>{pkg.version}</span
							>
							{#if pkg.official}
								<span
									class="rounded-full bg-blue-600/20 px-3 py-1 text-sm font-medium text-blue-400"
									>Official</span
								>
							{/if}
							{#if pkg.cncf}
								<span
									class="rounded-full bg-purple-600/20 px-3 py-1 text-sm font-medium text-purple-400"
									>CNCF</span
								>
							{/if}
						</div>

						<div class="text-gray-400">
							<span class="mr-1">by</span>
							<span class="font-medium text-gray-200"
								>{pkg.repository?.organization_display_name || pkg.repository?.user_alias}</span
							>
						</div>
					</div>

					<!-- Description -->
					{#if pkg.description}
						<p class="text-lg leading-relaxed text-gray-300">
							{pkg.description}
						</p>
					{/if}

					<!-- Metadata Row -->
					<div class="flex flex-wrap items-center gap-6 border-t border-gray-800/50 pt-6">
						<!-- Stars -->
						<div class="flex items-center gap-2">
							<div class="text-yellow-400">{@html Star}</div>
							<span class="text-sm font-semibold text-gray-200">{pkg.stars || 0}</span>
						</div>

						<!-- Signed Status -->
						<div class="flex items-center gap-2">
							<div class={pkg.signed ? 'text-green-400' : 'text-gray-500'}>
								{@html pkg.signed ? Signed : Unsigned}
							</div>
							<span class="{pkg.signed ? 'text-green-400' : 'text-gray-500'} text-sm">
								{pkg.signed ? 'Signed' : 'Unsigned'}
							</span>
							{#if pkg.signed && pkg.signatures}
								{#each pkg.signatures as sig}
									<span class="rounded bg-green-900/30 px-2 py-0.5 text-xs text-green-400"
										>{sig}</span
									>
								{/each}
							{/if}
						</div>

						<!-- Repository Link -->
						{#if pkg.repository?.url}
							<button
								onclick={() => Browser.OpenURL(pkg.repository.url)}
								class="flex items-center gap-2 text-blue-400 transition-colors hover:text-blue-300"
							>
								<div>{@html Link}</div>
								<span class="text-sm font-medium underline">Repository</span>
							</button>
						{/if}

						<!-- ArtifactHub Link -->
						<button
							onclick={() =>
								Browser.OpenURL(
									`https://artifacthub.io/packages/ig-gadget/${pkg.repository?.name}/${pkg.normalized_name}`
								)}
							class="flex items-center gap-2 text-purple-400 transition-colors hover:text-purple-300"
						>
							<div>{@html Link}</div>
							<span class="text-sm font-medium underline">ArtifactHub</span>
						</button>
					</div>
				</div>
			</div>

			<!-- Main Content Area -->
			<div class="flex flex-row gap-6 overflow-hidden">
				<div class="flex w-2/3 flex-col">
					<Panel title="README" icon={Book} color="blue">
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							role="article"
							aria-label="Package readme"
							class="marked overflow-auto rounded p-4 whitespace-pre-wrap"
							onclick={handleLinkClick}
						>
							{@html marked(pkg.readme || '')}
						</div>
					</Panel>
				</div>
				<div class="w-1/3">
					<Panel title="Images" icon={Code} color="green">
						<div class="flex flex-col gap-3">
							{#each pkg.containers_images as image}
								<a
									href="/gadgets/run/{image.image}{environmentID ? `?env=${environmentID}` : ''}"
									class="group"
								>
									<div
										class="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-4 transition-all hover:scale-[1.02] hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/10"
									>
										<div class="flex items-center gap-3">
											<div
												class="rounded-lg bg-green-600/10 p-2 text-green-400 transition-colors group-hover:bg-green-600/20"
											>
												{@html Play}
											</div>
											<div class="flex-1 font-medium text-gray-200">{image.name}</div>
										</div>
										<div class="flex flex-row flex-wrap gap-1.5">
											{#each image.platforms as platform}
												<div class="rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-400">
													{platform}
												</div>
											{/each}
										</div>
									</div>
								</a>
							{/each}
						</div>
					</Panel>
				</div>
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
