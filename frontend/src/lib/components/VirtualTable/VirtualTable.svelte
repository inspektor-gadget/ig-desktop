<script lang="ts" generics="T">
	import { useVirtualScroll } from './useVirtualScroll.svelte';

	/**
	 * VirtualTable Component
	 *
	 * A generic virtual scroll container for any list content (divs, cards, etc.).
	 * Only renders visible rows for high-performance scrolling of large datasets.
	 *
	 * NOTE: For HTML tables with fixed headers, column resizing, and proper table
	 * semantics, use VirtualTableBody instead. This component is for non-table lists.
	 *
	 * @example
	 * ```svelte
	 * <VirtualTable items={data} rowHeight={24}>
	 *   {#snippet row(item, index)}
	 *     <div class="card">{item.name}</div>
	 *   {/snippet}
	 * </VirtualTable>
	 * ```
	 */

	interface Props {
		/** Array of items to display */
		items: T[];
		/** Height of each row in pixels (default: 24) */
		rowHeight?: number;
		/** Number of extra rows to render above/below viewport (default: 5) */
		overscan?: number;
		/** Snippet for rendering each row */
		row: import('svelte').Snippet<[item: T, index: number]>;
	}

	let { items, rowHeight = 24, overscan = 5, row }: Props = $props();

	// State for scroll position and viewport dimensions
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	let container: HTMLDivElement | undefined = $state();

	// Calculate virtual scroll state using the utility
	const scrollState = $derived(
		useVirtualScroll({
			totalItems: items.length,
			rowHeight,
			viewportHeight,
			scrollTop,
			overscan
		})
	);

	// Get the visible slice of items to render
	const visibleItems = $derived(items.slice(scrollState.startIndex, scrollState.endIndex));

	// Handle scroll events
	function handleScroll(event: Event) {
		const target = event.target as HTMLDivElement;
		scrollTop = target.scrollTop;
	}

	// Handle viewport resize using ResizeObserver
	$effect(() => {
		if (!container) return;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// Update viewport height when container is resized
				viewportHeight = entry.contentRect.height;
			}
		});

		resizeObserver.observe(container);

		// Cleanup observer on component destroy
		return () => {
			resizeObserver.disconnect();
		};
	});

	// Initialize viewport height when container is available
	$effect(() => {
		if (container) {
			viewportHeight = container.clientHeight;
		}
	});
</script>

<div
	bind:this={container}
	class="virtual-scroll-container"
	onscroll={handleScroll}
	style="overflow-y: auto; height: 100%;"
>
	<div
		class="virtual-scroll-spacer"
		style="height: {scrollState.totalHeight}px; position: relative;"
	>
		<div
			class="virtual-scroll-content"
			style="transform: translateY({scrollState.offsetY}px); will-change: transform;"
		>
			{#each visibleItems as item, i}
				{@render row(item, scrollState.startIndex + i)}
			{/each}
		</div>
	</div>
</div>

<style>
	.virtual-scroll-container {
		overflow-y: auto;
		position: relative;
	}

	.virtual-scroll-spacer {
		position: relative;
	}

	.virtual-scroll-content {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
	}
</style>
