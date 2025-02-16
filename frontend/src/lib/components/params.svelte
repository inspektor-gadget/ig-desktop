<script>
	let { params, showDescriptions = true, values = {} } = $props();

	import Text from './params/text.svelte';
	import Select from './params/select.svelte';
	import Bool from './params/bool.svelte';
	import Number from './params/number.svelte';
	import Filter from './params/filter.svelte';
	import Annotations from './params/annotation.svelte';
	import Sort from './params/sort.svelte';

	const config = $state({
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

	let components = $derived(params.map((param) => {
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
	}));
</script>

{#each params as param, idx}
	{@const Component = components[idx]}
	<div class="flex flex-row border-b-gray-900 py-2 last:border-b-0 gap-4 text-sm" class:border-b={showDescriptions}>
		<Component {config} {param} />
	</div>
{/each}

<!--<div>{JSON.stringify(config)}</div>-->
