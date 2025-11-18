<script lang="ts">
	let {
		params,
		showDescriptions = true,
		values = {},
		showAdvanced = true
	}: {
		params: any[];
		showDescriptions?: boolean;
		values?: Record<string, any>;
		showAdvanced?: boolean;
	} = $props();

	import Text from './params/text.svelte';
	import Select from './params/select.svelte';
	import Bool from './params/bool.svelte';
	import Number from './params/number.svelte';
	import Filter from './params/filter.svelte';
	import Annotations from './params/annotation.svelte';
	import Sort from './params/sort.svelte';

	function getComponentForParam(param: any) {
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
	let categories: Array<{ key: string; items: any[] }> = $derived(
		Object.entries(
			params.reduce((acc, param) => {
				// Look for a tag that starts with "group:"
				const groupTag = param.tags?.find((tag: string) => tag.startsWith('group:')) || '';

				// Determine the key: if found, extract the group name; otherwise, use an empty string.
				const key = groupTag ? groupTag.slice('group:'.length) : '';

				// If this key isn't in the accumulator, initialize it as an array.
				if (!acc[key]) {
					acc[key] = [];
				}

				const newParam = {
					component: getComponentForParam(param),
					advanced: param.tags?.find((tag: string) => tag === 'advanced') || false,
					hide: param.tags?.find((tag: string) => tag === 'gui.hide') || false,
					...param
				};

				// Push the current item into the appropriate group.
				if (!newParam.hide && (showAdvanced || !newParam.advanced)) {
					acc[key].push(newParam);
				}

				return acc;
			}, {})
		)
			.sort(([aKey], [bKey]) => aKey.localeCompare(bKey))
			.map(([key, items]: [string, any]) => ({ key, items: items as any[] }))
			.filter((e: any) => e.items.length !== 0)
	);

	const config = $derived({
		values,
		get: (param: any) => {
			return config.values[(param.prefix || '') + param.key];
		},
		set: (param: any, value: any) => {
			if (!value) {
				delete config.values[(param.prefix || '') + param.key];
				return;
			}
			config.values[(param.prefix || '') + param.key] = '' + value;
		}
	});
</script>

<div class="flex flex-col gap-4">
	{#each categories as { key, items }}
		<div class="flex flex-col">
			{#if key}
				<div class="mb-4 text-lg">{key}</div>
			{/if}
			{#each items as param}
				<div
					class:pl-4={key}
					class="flex flex-row gap-4 border-b-gray-900 py-2 text-sm last:border-b-0"
					class:border-b={showDescriptions}
				>
					<param.component {config} {param} />
				</div>
			{/each}
		</div>
	{/each}
</div>

<!--<div>{JSON.stringify(config)}</div>-->
