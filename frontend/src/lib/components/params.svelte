<script>
	let { params, showDescriptions = true, values = {}, showAdvanced = true } = $props();

	import Text from './params/text.svelte';
	import Select from './params/select.svelte';
	import Bool from './params/bool.svelte';
	import Number from './params/number.svelte';
	import Filter from './params/filter.svelte';
	import Annotations from './params/annotation.svelte';
	import Sort from './params/sort.svelte';

	function getComponentForParam(param) {
		if (param.possibleValues) {
			return Select;
		}
		if (param.key === 'filter') {
			return Filter;
		}
		if (param.key === 'annotate') {
			return Annotations;
		}
		if (param.key === 'sort') {
			return Sort;
		}
		switch (param.typeHint || param.type) {
			case 'bool':
				return Bool;
			case 'number':
			case 'integer':
			case 'uint8':
			case 'uint16':
			case 'uint32':
			case 'uint64':
			case 'int8':
			case 'int16':
			case 'int32':
			case 'int64':
				return Number;
		}
		return Text;
	}

	// this rebuilds params into an array of groups, sorted lexicographically, with the default
	// being an empty key ('')
	let categories = $derived(Object.entries(params.reduce((acc, param) => {
		// Look for a tag that starts with "group:"
		const groupTag = param.tags?.find(tag => tag.startsWith('group:')) || '';

		// Determine the key: if found, extract the group name; otherwise, use an empty string.
		const key = groupTag ? groupTag.slice('group:'.length) : '';

		// If this key isn't in the accumulator, initialize it as an array.
		if (!acc[key]) {
			acc[key] = [];
		}

		const newParam = {
			component: getComponentForParam(param),
			advanced: param.tags?.find(tag => tag === 'advanced') || false,
			hide: param.tags?.find(tag => tag === 'gui.hide') || false,
			...param,
		}

		// Push the current item into the appropriate group.
		if (!newParam.hide && (showAdvanced || !newParam.advanced)) {
			acc[key].push(newParam);
		}

		return acc;
	}, {})).sort(([aKey], [bKey]) => aKey.localeCompare(bKey)).map(([key, items]) => ({ key, items })).filter(e =>
		e.items.length !== 0));

	const config = $derived({
		values,
		get: (param) => {
			return config.values[(param.prefix || '') + param.key];
		},
		set: (param, value) => {
			if (!value) {
				delete (config.values[(param.prefix || '') + param.key]);
				return;
			}
			config.values[(param.prefix || '') + param.key] = '' + value;
		}
	});
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-row justify-end">
		<div class="flex flex-row gap-2 items-center">
			<input type="checkbox" bind:checked={showAdvanced} />
			<button onclick={() => { showAdvanced = !showAdvanced }} class="text-xs">Show advanced options</button>
		</div>
	</div>
{#each categories as { key, items }}
	<div class="flex flex-col">
		{#if key}
			<div class="text-lg mb-4">{key}</div>
		{/if}
		{#each items as param}
			<div class:pl-4={key} class="flex flex-row border-b-gray-900 py-2 last:border-b-0 gap-4 text-sm"
						class:border-b={showDescriptions}>
				<param.component {config} {param} />
			</div>
		{/each}
	</div>
{/each}
</div>
