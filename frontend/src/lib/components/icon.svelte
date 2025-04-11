<script module>
	const images = import.meta.glob('$lib/icons/**.svg', {
		import: 'default',
		eager: true,
		query: '?raw'
	})
	console.log(images);
</script>

<script>
	const svgRegex = /<svg(.*?)>(.*)<\/svg>/s

	let { name, width = 16, height = 16 } = $props();

	let file = $derived.by(() => {
		const data = images['/src/lib/icons/' + name];
		const parts = svgRegex.exec(data+'');
		if (!parts) {
			return null;
		}
		let [, attributes, content] = parts;
		attributes = ` width="${width}" height="${height}" fill="currentColor" `+ attributes;
		return `<svg ${attributes}>${content}</svg>`
	});
</script>

{#if file}
	<div style="color: #fff">{@html file}</div>
{/if}
