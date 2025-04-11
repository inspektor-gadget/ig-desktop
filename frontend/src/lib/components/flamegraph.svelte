<script>
	let { ds, events } = $props();

	import FlamegraphNode from './flamegraph-node.svelte';
	import Flame from '$lib/icons/fa/fire.svg?raw';
	import Dots from '$lib/icons/dots-vertical.svg?raw';

	// Global configuration defines processing order and type.
	let config = $derived(ds.fields
		.filter(e => e.annotations['flamegraph.level'] !== undefined)
		.sort((a, b) => parseInt(a.annotations['flamegraph.level']) > parseInt(b.annotations['flamegraph.level']))
		.map(e => { return { key: e.fullName, type: e.annotations['flamegraph.type'] || 'single' } })
	);
	// const config = [
	// 	{ key: 'runtime.containerName', type: 'single' },
	// 	{ key: 'proc.comm', type: 'single' },
	// 	{ key: 'user_stack', type: 'stack' },
	// 	{ key: 'kern_stack', type: 'stack' },
	// ];

	const tree = $derived.by(() => {
		// Helper function to add a stack of frames to the tree.
		function addToTree(root, stack, sampleCount) {
			let node = root;
			// Walk through each frame in the stack.
			for (const frame of stack) {
				// Create the children container if it doesn't exist.
				node.children = node.children || {};
				// If the node for the frame doesn't exist, initialize it.
				if (!node.children[frame]) {
					node.children[frame] = { name: frame, value: 0, children: {} };
				}
				// Move to the child and update its cumulative sample count.
				node = node.children[frame];
				node.value += sampleCount;
			}
		}

		// Initialize the root of the flamegraph tree.
		let tree = { name: "root", value: 0, children: {} };

		// Process each event.
		for (const event of events) {
			// Assume the sample count is stored in a field with tag 'sample.count'.
			// Convert it to a number (default to 1 if not specified).
			const sampleCount = Number(event['samples'] || 1);
			tree.value += sampleCount; // Aggregate at the root.

			// Build the stack for this event based on configuration.
			let stack = [];
			for (const conf of config) {
				let fieldVal = event[conf.key] || '';
				if (!fieldVal) continue; // Skip missing fields.

				if (conf.type === 'single') {
					// Use the value as is.
					stack.push(fieldVal);
				} else if (conf.type === 'stack') {
					// Split the colon-separated string into frames.
					const frames = fieldVal.split(';').reverse();
					frames.forEach(frame => {
						const trimmed = frame.trim().replace(/^\[[^\]]+\]/, '');
						if (trimmed) stack.push(trimmed);
					});
				}
			}

			// Add this event's stack into the tree.
			addToTree(tree, stack, sampleCount);
		}

		// (Optional) Convert tree children from object to array format if needed for your SVG renderer.
		function convertChildrenToArray(node) {
			if (node.children) {
				// Convert the children dictionary to an array.
				node.children = Object.values(node.children);
				// Recursively do the same for all children.
				node.children.forEach(convertChildrenToArray);
			}
		}
		convertChildrenToArray(tree);

		// The `tree` variable now holds a hierarchical representation of your events.
		console.log(tree);

		return tree;
	});

	let width = $state(1000);
	let rowHeight = $state(20);

	// Compute maximum depth of the tree to size the SVG.
	function maxDepth(node, current = 0) {
		if (!node.children || node.children.length === 0) {
			return current;
		}
		return Math.max(...node.children.map(child => maxDepth(child, current + 1)));
	}

	let maxD = $derived(maxDepth({ children: tree.children }));
	let height = $derived((maxD + 1) * rowHeight);
</script>

<div class="flex flex-col overflow-x-auto overscroll-none h-full border-t-1 border-gray-500">
	<div
		class="sticky left-0 top-0 h-10 p-2 flex flex-row bg-gray-950 items-center text-base font-normal">
		<div class="pr-2">{@html Flame}</div>
		<h2 class="px-2">{ds.name}</h2>
		<div class="flex-1"></div>
		<button class="pl-2">{@html Dots}</button>
	</div>

	<div class="flex-col md:block scrollbar-hide text-sm border-b border-b-gray-950" bind:clientWidth={width}>
		<svg {width} {height}>
			<FlamegraphNode
				node={tree}
				x={0}
				y={0}
				parentValue={tree.value}
				width={width}
				depth={0}
				{rowHeight} />
		</svg>
	</div>
</div>
