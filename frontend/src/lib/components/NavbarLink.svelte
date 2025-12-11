<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { base, resolve } from '$app/paths';
	import { openExternalURL } from '$lib/utils/external-links';

	interface Props {
		href?: string | null;
		children: Snippet;
		target?: string | null;
		title?: string | null;
		onclick?: ((ev: MouseEvent) => void) | null;
	}

	let {
		href = null,
		children,
		target = null,
		title = null,
		onclick: onclickProp = null
	}: Props = $props();

	// Check if this link should be highlighted via query param (for visual purposes only)
	const highlightEnvId = $derived(page.url.searchParams.get('highlightEnvironment'));

	// The home path is the base path (e.g., '/igd-demo' or '/' or '')
	const homePath = $derived(base || '/');
	const isHomePath = $derived(href === homePath || href === `${base}/`);

	const active = $derived(
		href &&
			(page.url.pathname === href ||
				(!isHomePath && page.url.pathname.startsWith(href)) ||
				(highlightEnvId && href === resolve(`/env/${highlightEnvId}`)))
	);

	const handleClick = (ev: MouseEvent) => {
		if (onclickProp) {
			onclickProp(ev);
			return;
		}
		if (!target) {
			return true;
		}
		if (href) {
			openExternalURL(href);
		}
		ev.preventDefault();
		return false;
	};
</script>

{#snippet content()}
	<div class="absolute -left-3 flex h-full items-center">
		<div
			class={`${
				active ? 'h-10' : 'h-5 scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100'
			} w-1 origin-left rounded-r bg-white transition-all duration-200`}
		></div>
	</div>
	<div class="group-active:translate-y-px">
		<div
			class={`${
				!active
					? 'bg-brand rounded-2xl text-white'
					: 'group-hover:bg-brand rounded-3xl bg-gray-700 text-gray-100 group-hover:rounded-2xl group-hover:text-white'
			} flex h-12 w-12 items-center justify-center overflow-hidden transition-all duration-200`}
		>
			{@render children()}
		</div>
	</div>
{/snippet}

{#if href}
	<a {href} {target} onclick={handleClick} class="group relative block" {title}>
		{@render content()}
	</a>
{:else}
	<button type="button" onclick={handleClick} class="group relative block cursor-pointer" {title}>
		{@render content()}
	</button>
{/if}
