<script>
	import FlamegraphNode from './flamegraph-node.svelte';
	let { node, x, y, parentValue, width, depth, rowHeight } = $props();

	let nodeWidth = $derived(width * (node.value / parentValue));

	let color = $derived(`hsl(${(depth+20) % 360}, 70%, 60%)`)

	let childrenPositions = $derived.by(() => {
		let res = [];
		if (node.children && node.children.length > 0) {
			let cumX = x;
			for (let child of node.children) {
				let childWidth = nodeWidth * (child.value / node.value);
				res.push({ child, x: cumX, width: childWidth });
				cumX += childWidth;
			}
		}
		return res;
	});
</script>

<g>
	<rect {x} {y} width={nodeWidth} height={rowHeight} fill={color} stroke="rgba(255,255,255,0.3)" />
	<text x={x+5} y={y + rowHeight / 2 + 5} fill="#000" font-size="12">{node.name}</text>
	{#each childrenPositions as cp (cp.child.name)}
		<FlamegraphNode node={cp.child} x={cp.x} y={y + rowHeight} parentValue={node.value} width={nodeWidth} depth={depth + 1} {rowHeight} />
	{/each}
</g>
