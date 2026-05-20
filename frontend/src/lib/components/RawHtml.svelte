<script lang="ts">
	import DOMPurify from 'dompurify';

	/**
	 * Renders an untrusted HTML/SVG string after sanitizing it with DOMPurify.
	 *
	 * Use this instead of a bare `{@html}` for any markup that is not a
	 * compile-time constant — plugin icons, gadget metadata, rendered markdown.
	 */
	let { html }: { html: string } = $props();

	// DOMPurify needs a DOM; during SSR/prerender there is nothing to render yet.
	const sanitized = $derived(typeof window !== 'undefined' ? DOMPurify.sanitize(html) : '');
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- content is sanitized by DOMPurify above -->
{@html sanitized}
