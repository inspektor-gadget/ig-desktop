<script lang="ts">
	import type { ArraySnapshot } from '$lib/handlers/gadget.handler.svelte';

	interface Props {
		snapshots: ArraySnapshot[];
		selectedIndices: Set<number>;
		onSelect: (index: number, event: MouseEvent | KeyboardEvent) => void;
		onRangeSelect?: (startIndex: number, endIndex: number) => void;
		onSelectAll?: () => void;
	}

	let { snapshots, selectedIndices, onSelect, onRangeSelect, onSelectAll }: Props = $props();

	// Check if an index is selected
	function isSelected(index: number): boolean {
		return selectedIndices.has(index);
	}

	// Container and scroll dimensions
	let containerWidth = $state(400);
	let scrollContainer: HTMLDivElement | undefined = $state();
	let timelineContainer: HTMLDivElement | undefined = $state();

	// Focus index tracks the "active" end of a selection for keyboard navigation
	// This is separate from the selection anchor (tracked in parent as lastSelectedIndex)
	let focusIndex = $state(0);

	// Keep focusIndex in bounds when snapshots change
	$effect(() => {
		if (snapshots.length > 0 && focusIndex >= snapshots.length) {
			focusIndex = snapshots.length - 1;
		}
	});
	const height = 60;
	const margin = { top: 8, right: 8, bottom: 16, left: 8 };
	const boundedHeight = height - margin.top - margin.bottom;

	// Fixed bar dimensions for consistent appearance
	const barWidth = 12;
	const barSpacing = 16; // Space between bar centers

	// Calculate content width based on number of snapshots
	const contentWidth = $derived(
		Math.max(snapshots.length * barSpacing + margin.left + margin.right, containerWidth)
	);
	const boundedWidth = $derived(contentWidth - margin.left - margin.right);

	// Calculate time range from snapshots (oldest to newest)
	const timeRange = $derived.by(() => {
		if (snapshots.length === 0) return { min: Date.now(), max: Date.now() };
		// Snapshots are newest-first, so last is oldest
		const times = snapshots.map((s) => s.receivedAt);
		return {
			min: Math.min(...times),
			max: Math.max(...times)
		};
	});

	// Calculate max count for Y scale
	const maxCount = $derived(Math.max(...snapshots.map((s) => s.data.length), 1));

	// X position for a snapshot by index
	// Index 0 (newest) is at the right edge, higher indices go left
	function xPositionForIndex(index: number): number {
		// Start from right edge, move left by index * spacing
		const rightEdge = boundedWidth - barWidth / 2;
		return rightEdge - index * barSpacing;
	}

	// Convert x position to nearest snapshot index
	function xPositionToIndex(x: number): number {
		if (snapshots.length <= 1) return 0;
		const rightEdge = boundedWidth - barWidth / 2;
		// Calculate index from right edge
		const index = Math.round((rightEdge - x) / barSpacing);
		return Math.max(0, Math.min(snapshots.length - 1, index));
	}

	function yScale(count: number): number {
		return boundedHeight - (count / maxCount) * boundedHeight;
	}

	// Format time for axis labels
	function formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	// Drag selection state
	let isDragging = $state(false);
	let dragStartIndex = $state<number | null>(null);
	let dragCurrentIndex = $state<number | null>(null);
	let svgElement: SVGSVGElement | undefined = $state();

	// Get the drag selection range (min to max)
	const dragRange = $derived.by(() => {
		if (dragStartIndex === null || dragCurrentIndex === null) return null;
		return {
			start: Math.min(dragStartIndex, dragCurrentIndex),
			end: Math.max(dragStartIndex, dragCurrentIndex)
		};
	});

	// Check if an index is in the current drag range
	function isInDragRange(index: number): boolean {
		if (!dragRange) return false;
		return index >= dragRange.start && index <= dragRange.end;
	}

	// Get x position from mouse event relative to SVG content
	function getRelativeX(event: MouseEvent): number {
		if (!scrollContainer) return 0;
		const rect = scrollContainer.getBoundingClientRect();
		// Account for scroll position within the container
		return event.clientX - rect.left + scrollContainer.scrollLeft - margin.left;
	}

	function handleMouseDown(event: MouseEvent) {
		// Only handle left mouse button and when range select is available
		if (event.button !== 0 || !onRangeSelect) return;

		const x = getRelativeX(event);
		const index = xPositionToIndex(x);

		isDragging = true;
		dragStartIndex = index;
		dragCurrentIndex = index;

		// Prevent text selection during drag
		event.preventDefault();
	}

	function handleMouseMove(event: MouseEvent) {
		if (!isDragging) return;

		const x = getRelativeX(event);
		dragCurrentIndex = xPositionToIndex(x);
	}

	function handleMouseUp(event: MouseEvent) {
		if (!isDragging || dragStartIndex === null || dragCurrentIndex === null) {
			isDragging = false;
			return;
		}

		const start = Math.min(dragStartIndex, dragCurrentIndex);
		const end = Math.max(dragStartIndex, dragCurrentIndex);

		// If start === end, it was a click, not a drag - select that snapshot
		if (start === end) {
			onSelect(start, event);
			focusIndex = start;
		} else if (onRangeSelect) {
			// Actual drag across multiple items
			onRangeSelect(start, end);
			focusIndex = dragCurrentIndex;
		}

		// Always focus the timeline for keyboard navigation
		timelineContainer?.focus();

		isDragging = false;
		dragStartIndex = null;
		dragCurrentIndex = null;
	}

	function handleMouseLeave() {
		// Cancel drag if mouse leaves the component
		if (isDragging) {
			isDragging = false;
			dragStartIndex = null;
			dragCurrentIndex = null;
		}
	}

	// Component-level keyboard navigation (when timeline container is focused)
	function handleContainerKeydown(event: KeyboardEvent) {
		if (snapshots.length === 0) return;

		// Handle Ctrl+A / Cmd+A for select all
		if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
			event.preventDefault();
			event.stopPropagation();
			onSelectAll?.();
			return;
		}

		// Only handle navigation keys
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

		// Prevent browser's default scroll behavior
		event.preventDefault();
		event.stopPropagation();

		if (event.key === 'ArrowLeft') {
			// Left arrow = go to older snapshot (higher index)
			const newIndex = Math.min(focusIndex + 1, snapshots.length - 1);
			if (newIndex !== focusIndex) {
				onSelect(newIndex, event);
				focusIndex = newIndex;
				scrollToIndex(newIndex);
			}
		} else if (event.key === 'ArrowRight') {
			// Right arrow = go to newer snapshot (lower index)
			const newIndex = Math.max(focusIndex - 1, 0);
			if (newIndex !== focusIndex) {
				onSelect(newIndex, event);
				focusIndex = newIndex;
				scrollToIndex(newIndex);
			}
		} else if (event.key === 'Home') {
			// Home = go to newest snapshot (index 0)
			onSelect(0, event);
			focusIndex = 0;
			scrollToIndex(0);
		} else if (event.key === 'End') {
			// End = go to oldest snapshot
			const lastIndex = snapshots.length - 1;
			onSelect(lastIndex, event);
			focusIndex = lastIndex;
			scrollToIndex(lastIndex);
		}
	}

	// Scroll to make a snapshot index visible
	function scrollToIndex(index: number) {
		if (!scrollContainer) return;

		const x = xPositionForIndex(index);
		const scrollLeft = scrollContainer.scrollLeft;
		const viewportWidth = scrollContainer.clientWidth;

		// Calculate the position we need to scroll to
		const targetLeft = x - barWidth / 2 - margin.left;
		const targetRight = x + barWidth / 2 + margin.right;

		if (targetLeft < scrollLeft) {
			// Scroll left to show the bar
			scrollContainer.scrollTo({ left: Math.max(0, targetLeft - 20), behavior: 'smooth' });
		} else if (targetRight > scrollLeft + viewportWidth) {
			// Scroll right to show the bar
			scrollContainer.scrollTo({ left: targetRight - viewportWidth + 20, behavior: 'smooth' });
		}
	}

	// Auto-scroll to keep selected snapshot visible when selection changes
	$effect(() => {
		if (selectedIndices.size === 1) {
			const index = selectedIndices.values().next().value as number;
			// Use a microtask to ensure DOM is updated
			queueMicrotask(() => scrollToIndex(index));
		}
	});

	// Handle wheel events to enable horizontal scrolling with vertical mousewheel
	function handleWheel(event: WheelEvent) {
		if (!scrollContainer) return;

		// If there's horizontal scroll needed and user is scrolling vertically
		if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && contentWidth > containerWidth) {
			event.preventDefault();
			scrollContainer.scrollLeft += event.deltaY;
		}
	}
</script>

<div
	class="snapshot-timeline w-full border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 select-none"
	class:cursor-crosshair={onRangeSelect}
	bind:clientWidth={containerWidth}
	bind:this={timelineContainer}
	tabindex="0"
	role="listbox"
	aria-label="Snapshot timeline navigation. Use left/right arrows to navigate snapshots."
	aria-activedescendant={selectedIndices.size === 1
		? `snapshot-${selectedIndices.values().next().value}`
		: undefined}
	onkeydown={handleContainerKeydown}
	onwheel={handleWheel}
>
	<div class="scroll-container" bind:this={scrollContainer} tabindex="-1">
		<svg
			bind:this={svgElement}
			{height}
			width={contentWidth}
			onmousedown={handleMouseDown}
			onmousemove={handleMouseMove}
			onmouseup={handleMouseUp}
			onmouseleave={handleMouseLeave}
		>
			<g transform="translate({margin.left}, {margin.top})">
				<!-- Background grid line -->
				<line
					x1="0"
					y1={boundedHeight}
					x2={boundedWidth}
					y2={boundedHeight}
					stroke="#374151"
					stroke-width="1"
				/>

				<!-- Drag selection highlight rectangle -->
				{#if isDragging && dragRange}
					{@const startX = xPositionForIndex(dragRange.end)}
					{@const endX = xPositionForIndex(dragRange.start)}
					<rect
						x={startX - barWidth / 2 - 2}
						y={0}
						width={endX - startX + barWidth + 4}
						height={boundedHeight}
						fill="rgba(119, 187, 65, 0.15)"
						stroke="#77bb41"
						stroke-width="1"
						stroke-dasharray="4,2"
						rx="2"
						class="pointer-events-none"
					/>
				{/if}

				<!-- Bars for each snapshot -->
				{#each snapshots as snapshot, i (snapshot.batchId)}
					{@const x = xPositionForIndex(i) - barWidth / 2}
					{@const barHeight = boundedHeight - yScale(snapshot.data.length)}
					{@const selected = isSelected(i)}
					{@const inDragRange = isInDragRange(i)}
					<g
						class="cursor-pointer"
						role="option"
						id="snapshot-{i}"
						aria-selected={selected}
						aria-label="{snapshot.data.length} events at {formatTime(snapshot.receivedAt)}"
						data-snapshot-index={i}
					>
						<!-- Transparent hit area for easier clicking on small bars -->
						<rect {x} y={0} width={barWidth} height={boundedHeight} fill="transparent" />
						<rect
							{x}
							y={yScale(snapshot.data.length)}
							width={barWidth}
							height={barHeight}
							fill={selected ? '#77bb41' : inDragRange ? '#9fcc6d' : '#4b5563'}
							rx="1"
							class="transition-colors"
							class:hover:fill-gray-400={!selected && !inDragRange && !isDragging}
							class:hover:fill-green-400={selected && !isDragging}
						/>
						<!-- Focus ring for keyboard navigation -->
						{#if selected}
							<rect
								x={x - 2}
								y={yScale(snapshot.data.length) - 2}
								width={barWidth + 4}
								height={barHeight + 4}
								fill="none"
								stroke="#77bb41"
								stroke-width="1"
								rx="2"
								class="pointer-events-none"
							/>
						{/if}
						<!-- Hover tooltip area (larger hit target) -->
						<title
							>{snapshot.data.length} events at {formatTime(snapshot.receivedAt)}{selected
								? ' (selected)'
								: ''}</title
						>
					</g>
				{/each}

				<!-- Selected indicator lines (only show when bar has no visible height) -->
				{#each snapshots as snapshot, i (snapshot.batchId)}
					{#if isSelected(i) && snapshot.data.length === 0}
						{@const selectedX = xPositionForIndex(i)}
						<line
							x1={selectedX}
							y1={0}
							x2={selectedX}
							y2={boundedHeight}
							stroke="#77bb41"
							stroke-width="1"
							stroke-dasharray="2,2"
							pointer-events="none"
						/>
					{/if}
				{/each}
			</g>

			<!-- Time labels -->
			<g transform="translate({margin.left}, {height - 4})">
				<text x="0" y="0" fill="#6b7280" font-size="9" text-anchor="start">
					{formatTime(timeRange.min)}
				</text>
				<text x={boundedWidth} y="0" fill="#6b7280" font-size="9" text-anchor="end">
					{formatTime(timeRange.max)}
				</text>
			</g>
		</svg>
	</div>
</div>

<style>
	.snapshot-timeline {
		height: 76px;
		flex-shrink: 0;
		outline: none;
	}

	.scroll-container {
		width: 100%;
		height: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		/* Hide scrollbar while maintaining scroll functionality */
		scrollbar-width: none; /* Firefox */
		-ms-overflow-style: none; /* IE/Edge */
		/* Prevent scroll container from being keyboard navigable */
		outline: none;
	}

	.scroll-container::-webkit-scrollbar {
		display: none; /* Chrome, Safari, Opera */
	}

	/* Prevent native keyboard scrolling on the scroll container */
	.scroll-container:focus {
		outline: none;
	}
</style>
