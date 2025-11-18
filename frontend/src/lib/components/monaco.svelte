<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type * as Monaco from 'monaco-editor';

	let { content, readOnly = false } = $props();

	let editor = $state<Monaco.editor.IStandaloneCodeEditor | null>(null);
	let monaco: typeof Monaco;
	let editorContainer: HTMLDivElement;

	$effect(() => {
		if (!editor) return;
		console.log('updating text');
		const model = monaco.editor.createModel(content, 'c');
		editor.setModel(model);
	});

	onMount(async () => {
		// Import our 'monaco.ts' file here
		// (onMount() will only be executed in the browser, which is what we want)
		monaco = (await import('../monaco')).default;

		// Your monaco instance is ready, let's display some code!
		editor = monaco.editor.create(editorContainer, {
			automaticLayout: true,
			readOnly
		});
		const model = monaco.editor.createModel(content, 'c');
		editor.setModel(model);

		monaco.editor.defineTheme('default', {
			base: 'vs-dark',
			inherit: true,
			rules: [
				{
					token: 'identifier',
					foreground: '9CDCFE'
				},
				{
					token: 'identifier.function',
					foreground: 'DCDCAA'
				},
				{
					token: 'type',
					foreground: '1AAFB0'
				}
			],
			colors: {}
		});
		monaco.editor.setTheme('default');
	});

	onDestroy(() => {
		monaco?.editor.getModels().forEach((model) => model.dispose());
		editor?.dispose();
	});
</script>

<div class="h-full w-full" bind:this={editorContainer}></div>
