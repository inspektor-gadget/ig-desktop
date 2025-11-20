<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { Browser } from '@wailsio/runtime';

	interface Props {
		href: string;
		children: Snippet;
		target?: string | null;
		title?: string | null;
	}

	let { href, children, target = null, title = null }: Props = $props();

	const active = $derived(
		page.url.pathname === href || (href !== '/' && page.url.pathname.startsWith(href))
	);

	const onclick = (ev: MouseEvent) => {
		if (!target) {
			return true;
		}
		Browser.OpenURL(href);
		ev.preventDefault();
		return false;
	};
</script>

<a {href} {target} {onclick} class="group relative block" {title}>
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
</a>
