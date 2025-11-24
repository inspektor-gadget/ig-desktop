<script lang="ts">
	import Title from './Title.svelte';
	import Input from '$lib/components/forms/Input.svelte';
	import Textarea from '$lib/components/forms/Textarea.svelte';

	interface Param {
		key: string;
		title?: string;
		description?: string;
		defaultValue?: string;
		tags?: string[];
	}

	interface Config {
		get: (param: Param) => string;
		set: (param: Param, value: string) => void;
	}

	interface Props {
		param: Param;
		config: Config;
	}

	let { param, config }: Props = $props();

	const isMultiline = $derived(param.tags?.find((tag) => tag === 'multiline'));

	let value = $state(config.get(param) || '');

	$effect(() => {
		config.set(param, value);
	});
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div class="grow">
	{#if isMultiline}
		<Textarea bind:value rows={4} placeholder={param.defaultValue} class="text-sm" />
	{:else}
		<Input bind:value placeholder={param.defaultValue} class="text-sm" />
	{/if}
</div>
