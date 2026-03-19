<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	interface Props {
		children: Snippet;
		href: string;
		shrink?: boolean;
		exact?: boolean;
	}

	let { children, href, shrink = false, exact = false }: Props = $props();

	const active = $derived(exact ? page.url.pathname === href : page.url.pathname.startsWith(href));
</script>

<a
	{href}
	class:flex-0={shrink}
	class:flex-1={!shrink}
	class={active
		? 'h-full cursor-default content-center border-r border-b border-ig-border border-t-ig-text-muted border-b-transparent p-2 text-nowrap overflow-ellipsis text-ig-text'
		: 'h-full flex-1 cursor-default content-center border-r border-b border-ig-border border-t-ig-border-strong bg-ig-surface-raised p-2 text-nowrap overflow-ellipsis hover:bg-ig-border hover:text-ig-text-muted'}
	>{@render children()}</a
>
