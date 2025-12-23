<script lang="ts">
	import Title from '$lib/components/params/Title.svelte';
	import { getContext } from 'svelte';
	import Delete from '$lib/icons/fa/trash.svg?raw';
	import SortUp from '$lib/icons/fa/sort-up.svg?raw';
	import SortDown from '$lib/icons/fa/sort-down.svg?raw';
	import type { GadgetParam, ParamConfig, GadgetInfo } from '$lib/types';

	interface FieldOption {
		ds: string;
		field: string;
		display: string;
	}

	type SortDirection = '' | '-';

	interface SortEntry {
		field: FieldOption;
		sorting: SortDirection;
	}

	interface Props {
		param: GadgetParam;
		config: ParamConfig;
	}

	const sortOperations: Record<SortDirection, { icon: string; title: string }> = {
		'-': { icon: SortUp, title: 'Descending' },
		'': { icon: SortDown, title: 'Ascending' }
	};

	const currentGadget = getContext<() => GadgetInfo | null>('currentGadget');

	const fields = $derived.by(() => {
		const gadgetInfo = currentGadget?.();
		const dataSources = gadgetInfo?.dataSources ?? [];
		if (dataSources.length === 0) {
			return [];
		}
		const tmpFields: FieldOption[] = [];
		dataSources.forEach((ds) => {
			ds.fields?.forEach((f) => {
				tmpFields.push({ ds: ds.name, field: f.fullName, display: ds.name + '.' + f.fullName });
			});
		});
		return tmpFields;
	});

	let { param, config }: Props = $props();
	let sortEntries = $state<SortEntry[]>([]);
	let initialized = false;

	/**
	 * Parse sort string format: datasource:field,-field2;datasource2:field3
	 * Prefix '-' indicates descending order
	 */
	function parseSortString(value: string): SortEntry[] {
		if (!value) return [];
		const result: SortEntry[] = [];

		// Split by semicolon for different datasources
		const dsParts = value.split(';');
		for (const dsPart of dsParts) {
			const colonIdx = dsPart.indexOf(':');
			if (colonIdx === -1) continue;

			const ds = dsPart.slice(0, colonIdx);
			const fieldsStr = dsPart.slice(colonIdx + 1);

			// Split by comma for different fields
			const fieldParts = fieldsStr.split(',');
			for (const fieldPart of fieldParts) {
				let sorting: SortDirection = '';
				let fieldName = fieldPart;
				if (fieldPart.startsWith('-')) {
					sorting = '-';
					fieldName = fieldPart.slice(1);
				}
				result.push({
					field: { ds, field: fieldName, display: `${ds}.${fieldName}` },
					sorting
				});
			}
		}
		return result;
	}

	/**
	 * Serialize sort entries back to string format
	 */
	function serializeSortEntries(entries: SortEntry[]): string {
		const dataSources: Record<string, SortEntry[]> = {};
		entries.forEach((entry) => {
			const dsName = entry.field.ds;
			if (!dataSources[dsName]) {
				dataSources[dsName] = [];
			}
			dataSources[dsName].push(entry);
		});

		return Object.entries(dataSources)
			.map(([ds, dsEntries]) => {
				const fieldStr = dsEntries.map((e) => `${e.sorting}${e.field.field}`).join(',');
				return `${ds}:${fieldStr}`;
			})
			.join(';');
	}

	// Initialize from config value on mount
	$effect(() => {
		if (!initialized) {
			const initialValue = config.get(param);
			if (initialValue) {
				sortEntries = parseSortString(initialValue);
			}
			initialized = true;
		}
	});

	// Sync sort entries to config (only after initialization)
	$effect(() => {
		if (!initialized) return;
		if (sortEntries.length === 0) {
			config.set(param, undefined);
		} else {
			config.set(param, serializeSortEntries(sortEntries));
		}
	});

	function addSortEntry() {
		const defaultField = fields[0] || { ds: '', field: '', display: '' };
		sortEntries.push({ field: defaultField, sorting: '' });
	}

	function removeSortEntry(idx: number) {
		sortEntries.splice(idx, 1);
	}

	function toggleSortDirection(entry: SortEntry) {
		entry.sorting = entry.sorting === '' ? '-' : '';
	}
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div class="flex flex-col gap-1">
	{#each sortEntries as entry, idx (idx)}
		<div class="flex flex-row items-start items-stretch gap-1">
			<div class="grid">
				<svg
					class="pointer-events-none relative right-1 z-10 col-start-1 row-start-1 h-4 w-4 self-center justify-self-end forced-colors:hidden"
					viewBox="0 0 16 16"
					fill="currentColor"
					aria-hidden="true"
				>
					<path
						fill-rule="evenodd"
						d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
						clip-rule="evenodd"
					></path>
				</svg>
				<select
					class="col-start-1 row-start-1 appearance-none rounded bg-gray-100 dark:bg-gray-800 p-1.5 pr-8 pl-3"
					bind:value={entry.field}
				>
					{#each fields as field (field.display)}
						<option value={field}>{field.display}</option>
					{/each}
				</select>
			</div>
			<div class="grid">
				<button
					title={sortOperations[entry.sorting].title}
					onclick={() => toggleSortDirection(entry)}
					class="cursor-pointer rounded bg-gray-100 dark:bg-gray-800 p-2 hover:bg-gray-200 dark:hover:bg-gray-700"
				>
					{@html sortOperations[entry.sorting].icon}
				</button>
			</div>
			<button
				class="flex cursor-pointer flex-row items-center gap-2 rounded bg-red-200 dark:bg-red-900 text-red-800 dark:text-red-100 px-2 py-1 hover:bg-red-300 dark:hover:bg-red-800"
				onclick={() => removeSortEntry(idx)}
			>
				<span>{@html Delete}</span>
			</button>
		</div>
	{/each}
	<div>
		<button
			class="flex cursor-pointer flex-row items-center gap-2 rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-700"
			onclick={addSortEntry}
		>
			<span>Add Sorting</span>
		</button>
	</div>
</div>
