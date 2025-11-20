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
		? 'h-full cursor-default content-center border-r border-b border-gray-700 border-t-gray-500 border-b-transparent p-2 text-nowrap overflow-ellipsis text-gray-50'
		: 'h-full flex-1 cursor-default content-center border-r border-b border-gray-700 border-t-gray-600 bg-gray-950 p-2 text-nowrap overflow-ellipsis hover:bg-white/5 hover:text-gray-400'}
	>{@render children()}</a
>
