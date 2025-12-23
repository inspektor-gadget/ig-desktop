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

	import Text from './params/Text.svelte';
	import Select from './params/Select.svelte';
	import Bool from './params/Bool.svelte';
	import Number from './params/Number.svelte';
	import { pluginRegistry } from '$lib/services/plugin-registry.service.svelte';
	import type { GadgetParam } from '$lib/types';

	function getComponentForParam(param: GadgetParam) {
		// Check plugin registry first for custom param inputs
		const plugin = pluginRegistry.getParamInputForParam(param);
		if (plugin?.component) {
			return plugin.component;
		}

		// Fallback to built-in simple types
		if (param.possibleValues && param.possibleValues.length > 0) {
			return Select;
		}
		switch (param.typeHint) {
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

	// Create a mapping of valueHints to parameter keys for dependency tracking
	const valueHintToKey = $derived.by(() => {
		const mapping: Record<string, string> = {};
		for (const param of params) {
			if (param.valueHint) {
				const fullKey = (param.prefix || '') + param.key;
				mapping[param.valueHint] = fullKey;
			}
		}
		return mapping;
	});

	const config = $derived({
		values,
		valueHintToKey,
		get: (param: any) => {
			return config.values[(param.prefix || '') + param.key];
		},
		set: (param: any, value: any) => {
			// Delete if value is falsy, empty string, or empty array
			if (!value || value === '' || (Array.isArray(value) && value.length === 0)) {
				delete config.values[(param.prefix || '') + param.key];
				return;
			}
			// For arrays, join with commas; otherwise convert to string
			config.values[(param.prefix || '') + param.key] = Array.isArray(value)
				? value.join(',')
				: '' + value;
		},
		getAll: () => {
			return config.values;
		},
		getByValueHint: (valueHint: string) => {
			const key = config.valueHintToKey[valueHint];
			return key ? config.values[key] : undefined;
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
					class="flex flex-row gap-4 border-b-gray-200 dark:border-b-gray-800 py-2 text-sm last:border-b-0"
					class:border-b={showDescriptions}
				>
					<param.component {config} {param} {values} />
				</div>
			{/each}
		</div>
	{/each}
</div>

<!--<div>{JSON.stringify(config)}</div>-->
