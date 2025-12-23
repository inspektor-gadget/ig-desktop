<script lang="ts">
	import Title from '$lib/components/params/Title.svelte';
	import { getContext } from 'svelte';
	import Delete from '$lib/icons/fa/trash.svg?raw';
	import Select from '$lib/components/forms/Select.svelte';
	import Input from '$lib/components/forms/Input.svelte';
	import type { GadgetParam, ParamConfig, GadgetInfo } from '$lib/types';

	interface FieldOption {
		key: string;
		display: string;
	}

	interface AnnotationEntry {
		field: string;
		key: string;
		value: string;
	}

	interface Props {
		param: GadgetParam;
		config: ParamConfig;
	}

	const currentGadget = getContext<() => GadgetInfo | null>('currentGadget');

	const fields = $derived.by(() => {
		const gadgetInfo = currentGadget?.();
		const dataSources = gadgetInfo?.dataSources ?? [];
		if (dataSources.length === 0) {
			return [];
		}
		const tmpFields: FieldOption[] = [];
		dataSources.forEach((ds) => {
			tmpFields.push({ key: ds.name, display: ds.name });
			ds.fields?.forEach((f) => {
				tmpFields.push({
					key: ds.name + '.' + f.fullName,
					display: '- ' + ds.name + '.' + f.fullName
				});
			});
		});
		return tmpFields;
	});

	let { param, config }: Props = $props();
	let annotations = $state<AnnotationEntry[]>([]);
	let initialized = false;

	/**
	 * Parse annotation string format: field:key=value,field2:key2=value2
	 * Handles escaped commas (\,) within values
	 */
	function parseAnnotationString(value: string): AnnotationEntry[] {
		if (!value) return [];
		const result: AnnotationEntry[] = [];

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
			// Format: field:key=value
			const colonIdx = part.indexOf(':');
			if (colonIdx === -1) continue;

			const field = part.slice(0, colonIdx);
			const rest = part.slice(colonIdx + 1);
			const eqIdx = rest.indexOf('=');
			if (eqIdx === -1) continue;

			const key = rest.slice(0, eqIdx);
			const val = rest.slice(eqIdx + 1);
			result.push({ field, key, value: val });
		}
		return result;
	}

	/**
	 * Serialize annotations back to string format
	 */
	function serializeAnnotations(entries: AnnotationEntry[]): string {
		return entries
			.map((entry) => {
				const escapedValue = entry.value?.replace(/\\/g, '\\\\').replace(/,/g, '\\,') || '';
				return `${entry.field}:${entry.key || ''}=${escapedValue}`;
			})
			.join(',');
	}

	// Initialize from config value on mount
	$effect(() => {
		if (!initialized) {
			const initialValue = config.get(param);
			if (initialValue) {
				annotations = parseAnnotationString(initialValue);
			}
			initialized = true;
		}
	});

	// Sync annotations to config (only after initialization)
	$effect(() => {
		if (!initialized) return;
		if (annotations.length === 0) {
			config.set(param, undefined);
		} else {
			config.set(param, serializeAnnotations(annotations));
		}
	});

	function addAnnotation() {
		annotations.push({ field: '', key: '', value: '' });
	}

	function removeAnnotation(idx: number) {
		annotations.splice(idx, 1);
	}
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div class="flex flex-col gap-1">
	{#each annotations as annotation, idx (idx)}
		<div class="flex flex-row items-start items-stretch gap-1">
			<Select
				bind:value={annotation.field}
				options={fields.map((f) => ({ value: f.key, label: f.display }))}
				class="text-sm"
			/>
			<div class="flex grow flex-row">
				<Input bind:value={annotation.key} placeholder={param.defaultValue} class="text-sm" />
			</div>
			<div class="flex grow flex-row">
				<Input bind:value={annotation.value} placeholder={param.defaultValue} class="text-sm" />
			</div>
			<button
				class="flex cursor-pointer flex-row items-center gap-2 rounded bg-red-200 dark:bg-red-900 text-red-800 dark:text-red-100 px-2 py-1 hover:bg-red-300 dark:hover:bg-red-800"
				onclick={() => removeAnnotation(idx)}
			>
				<span>{@html Delete}</span>
			</button>
		</div>
	{/each}
	<div>
		<button
			class="flex cursor-pointer flex-row items-center gap-2 rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-700"
			onclick={addAnnotation}
		>
			<span>Add Annotation</span>
		</button>
	</div>
</div>
