<script lang="ts">
	import Title from '$lib/components/params/Title.svelte';
	import { getContext } from 'svelte';
	import Delete from '$lib/icons/fa/trash.svg?raw';
	import Select from '$lib/components/forms/Select.svelte';
	import Input from '$lib/components/forms/Input.svelte';
	import type { GadgetParam, ParamConfig, GadgetInfo } from '$lib/types';

	interface FieldInfo {
		ds: string;
		fullName: string;
	}

	interface FilterEntry {
		key: string;
		op: string;
		value: string;
	}

	interface Props {
		param: GadgetParam;
		config: ParamConfig;
	}

	const operations = [
		{ key: '==', description: 'equals' },
		{ key: '!=', description: 'not equals' },
		{ key: '<=', description: 'less than or equals' },
		{ key: '>=', description: 'greater than or equals' },
		{ key: '<', description: 'less than' },
		{ key: '>', description: 'greater than' },
		{ key: '~=', description: 'matches regular expression' }
	] as const;

	// Operators sorted by length descending to match longer ones first (e.g., <= before <)
	const operatorKeys = [...operations].map((op) => op.key).sort((a, b) => b.length - a.length);

	const currentGadget = getContext<() => GadgetInfo | null>('currentGadget');

	const fields = $derived.by(() => {
		const gadgetInfo = currentGadget?.();
		const dataSources = gadgetInfo?.dataSources ?? [];
		if (dataSources.length === 0) {
			return [];
		}
		const tmpFields: FieldInfo[] = [];
		dataSources.forEach((ds) => {
			ds.fields?.forEach((f) => {
				tmpFields.push({ ds: ds.name, fullName: f.fullName });
			});
		});
		return tmpFields;
	});

	let { param, config }: Props = $props();
	let filters = $state<FilterEntry[]>([]);
	let initialized = false;

	/**
	 * Parse filter string format: datasource:field<op>value,datasource:field2<op>value2
	 * Handles escaped commas (\,) within values
	 */
	function parseFilterString(value: string): FilterEntry[] {
		if (!value) return [];
		const result: FilterEntry[] = [];

		// Split by comma but respect escaped commas
		const parts: string[] = [];
		let current = '';
		for (let i = 0; i < value.length; i++) {
			if (value[i] === '\\' && i + 1 < value.length) {
				current += value[i + 1];
				i++;
			} else if (value[i] === ',') {
				parts.push(current);
				current = '';
			} else {
				current += value[i];
			}
		}
		if (current) parts.push(current);

		for (const part of parts) {
			// Find the operator (check longer operators first)
			let foundOp = '';
			let opIdx = -1;
			for (const op of operatorKeys) {
				const idx = part.indexOf(op);
				if (idx !== -1) {
					foundOp = op;
					opIdx = idx;
					break;
				}
			}
			if (opIdx === -1) continue;

			const key = part.slice(0, opIdx);
			const val = part.slice(opIdx + foundOp.length);
			result.push({ key, op: foundOp, value: val });
		}
		return result;
	}

	/**
	 * Serialize filters back to string format
	 */
	function serializeFilters(entries: FilterEntry[]): string {
		return entries
			.map((entry) => {
				const escapedValue = entry.value?.replace(/\\/g, '\\\\').replace(/,/g, '\\,') || '';
				return `${entry.key}${entry.op}${escapedValue}`;
			})
			.join(',');
	}

	// Initialize from config value on mount
	$effect(() => {
		if (!initialized) {
			const initialValue = config.get(param);
			if (initialValue) {
				filters = parseFilterString(initialValue);
			}
			initialized = true;
		}
	});

	// Sync filters to config (only after initialization)
	$effect(() => {
		if (!initialized) return;
		if (filters.length === 0) {
			config.set(param, undefined);
		} else {
			config.set(param, serializeFilters(filters));
		}
	});

	function addFilter() {
		filters.push({ key: '', op: '==', value: '' });
	}

	function removeFilter(idx: number) {
		filters.splice(idx, 1);
	}
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div class="flex flex-col gap-1">
	{#each filters as filter, idx (idx)}
		<div class="flex flex-row items-start items-stretch gap-1">
			<Select
				bind:value={filter.key}
				options={fields.map((f) => ({
					value: `${f.ds}:${f.fullName}`,
					label: `${f.ds}:${f.fullName}`
				}))}
				class="text-sm"
			/>
			<Select
				bind:value={filter.op}
				options={operations.map((op) => ({ value: op.key, label: op.key }))}
				class="text-sm"
			/>
			<div class="flex grow flex-row">
				<Input bind:value={filter.value} placeholder={param.defaultValue} class="text-sm" />
			</div>
			<button
				class="flex cursor-pointer flex-row items-center gap-2 rounded bg-red-200 dark:bg-red-900 text-red-800 dark:text-red-100 px-2 py-1 hover:bg-red-300 dark:hover:bg-red-800"
				onclick={() => removeFilter(idx)}
			>
				<span>{@html Delete}</span>
			</button>
		</div>
	{/each}
	<div>
		<button
			class="flex cursor-pointer flex-row items-center gap-2 rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-700"
			onclick={addFilter}
		>
			<span>Add Filter</span>
		</button>
	</div>
</div>
