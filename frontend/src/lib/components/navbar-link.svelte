<script>
	import { page } from '$app/state';

	let { href, children, target = null, title=null } = $props();
	let active = $derived(page.url.pathname.startsWith(href));
</script>
<a {href} {target} class="group block relative" {title}>
	<div class="flex absolute -left-3 items-center h-full">
		<div
			class={`${
					active
						? 'h-10'
						: 'h-5 scale-0 opacity-0 group-hover:opacity-100 group-hover:scale-100'
				} w-1 transition-all duration-200 origin-left bg-white rounded-r`}
		></div>
	</div>
	<div class="group-active:translate-y-px">
		<div
			class={`${
					!active
						? 'rounded-2xl bg-brand text-white'
						: 'text-gray-100 group-hover:rounded-2xl group-hover:bg-brand group-hover:text-white bg-gray-700 rounded-3xl'
				} flex items-center justify-center w-12 h-12 transition-all duration-200 overflow-hidden`}
		>
			{@render children()}
		</div>
	</div>
</a>
