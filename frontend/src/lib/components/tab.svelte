<script>
	import { page } from '$app/state';

	let { children, href, shrink = false, exact = false } = $props();

	let active = $derived(exact ? page.url.pathname === href : page.url.pathname.startsWith(href));
</script>

<a {href} class:flex-0={shrink} class:flex-1={!shrink} class={active ?
'content-center h-full cursor-default border-r border-t border-b border-b-transparent border-gray-700 border-t-gray-500 p-2 text-nowrap overflow-ellipsis text-gray-50 bg-gray-900' : 'content-center h-full cursor-default flex-1 border-r border-t border-b border-t-transparent border-gray-700 border-t-gray-600 p-2 text-nowrap hover:text-gray-400 overflow-ellipsis hover:bg-white/5'}>{@render children()}</a>
