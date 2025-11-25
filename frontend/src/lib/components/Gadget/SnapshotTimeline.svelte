<script lang="ts">
	import type { ArraySnapshot } from '$lib/handlers/gadget.handler.svelte';

	interface Props {
		snapshots: ArraySnapshot[];
		selectedIndices: Set<number>;
		onSelect: (index: number, event: MouseEvent | KeyboardEvent) => void;
		onRangeSelect?: (startIndex: number, endIndex: number) => void;
	}

	let { snapshots, selectedIndices, onSelect, onRangeSelect }: Props = $props();

	// Check if an index is selected
	function isSelected(index: number): boolean {
		return selectedIndices.has(index);
	}

	// Container dimensions
	let containerWidth = $state(400);
	const height = 60;
	const margin = { top: 8, right: 8, bottom: 16, left: 8 };
	const boundedWidth = $derived(Math.max(containerWidth - margin.left - margin.right, 0));
	const boundedHeight = height - margin.top - margin.bottom;

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

	// Bar width and spacing - fixed size, bars grow from right to left
	const barWidth = $derived(
		Math.max(4, Math.min(20, boundedWidth / Math.max(snapshots.length, 1) - 2))
	);
	const barSpacing = $derived(barWidth + 4); // Fixed spacing between bars

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

	// Get x position from mouse event relative to SVG
	function getRelativeX(event: MouseEvent): number {
		if (!svgElement) return 0;
		const rect = svgElement.getBoundingClientRect();
		return event.clientX - rect.left - margin.left;
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

	function handleMouseUp() {
		if (!isDragging || dragStartIndex === null || dragCurrentIndex === null) {
			isDragging = false;
			return;
		}

		const start = Math.min(dragStartIndex, dragCurrentIndex);
		const end = Math.max(dragStartIndex, dragCurrentIndex);

		// Only trigger range select if dragged across multiple items
		if (start !== end && onRangeSelect) {
			onRangeSelect(start, end);
		}

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

	// Keyboard navigation handler
	function handleKeydown(index: number, event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onSelect(index, event);
		} else if (event.key === 'ArrowLeft') {
			// Left arrow = go to older snapshot (higher index, displayed to the left)
			event.preventDefault();
			if (index < snapshots.length - 1) {
				onSelect(index + 1, event);
				// Focus the new element
				const newElement = document.querySelector(
					`[data-snapshot-index="${index + 1}"]`
				) as HTMLElement;
				newElement?.focus();
			}
		} else if (event.key === 'ArrowRight') {
			// Right arrow = go to newer snapshot (lower index, displayed to the right)
			event.preventDefault();
			if (index > 0) {
				onSelect(index - 1, event);
				// Focus the new element
				const newElement = document.querySelector(
					`[data-snapshot-index="${index - 1}"]`
				) as HTMLElement;
				newElement?.focus();
			}
		}
	}
</script>

<div
	class="snapshot-timeline w-full border-t border-gray-700 bg-gray-900 select-none"
	class:cursor-crosshair={onRangeSelect}
	bind:clientWidth={containerWidth}
>
	<svg
		bind:this={svgElement}
		{height}
		width="100%"
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
					class="cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500"
					onclick={(e) => {
						if (!isDragging) onSelect(i, e);
					}}
					role="button"
					tabindex="0"
					onkeydown={(e) => handleKeydown(i, e)}
					data-snapshot-index={i}
					aria-label="Snapshot {i + 1} of {snapshots.length}: {snapshot.data
						.length} events at {formatTime(snapshot.receivedAt)}"
					aria-pressed={selected}
				>
					<!-- Transparent hit area for easier clicking on small bars -->
					<rect
						{x}
						y={0}
						width={barWidth}
						height={boundedHeight}
						fill="transparent"
					/>
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

			<!-- Selected indicator lines (show dashed line for each selected snapshot) -->
			{#each snapshots as snapshot, i (snapshot.batchId)}
				{#if isSelected(i)}
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

<style>
	.snapshot-timeline {
		height: 76px;
		flex-shrink: 0;
	}
</style>
