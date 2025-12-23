<script lang="ts">
	import { setContext } from 'svelte';
	import K8sAutocomplete from '$lib/plugins/builtin/params/k8s-autocomplete/K8sAutocomplete.svelte';
	import AutocompleteInput from '$lib/components/forms/AutocompleteInput.svelte';
	import type { WizardTargetParams } from './wizard-types';

	interface Props {
		isKubernetes: boolean;
		params: WizardTargetParams;
		environmentID: string;
	}

	let { isKubernetes, params = $bindable(), environmentID }: Props = $props();

	// Set up the environmentID context that K8sAutocomplete expects
	setContext('environmentID', () => environmentID);

	// Internal mutable values object (similar to how Params.svelte works)
	// This avoids infinite loops from reassigning the bound params object
	let values = $state<Record<string, string | string[]>>({});

	// Sync values back to params when they change
	$effect(() => {
		// Only update params if values actually changed
		const newParams: WizardTargetParams = {};
		if (values.namespace) newParams.namespace = values.namespace as string;
		if (values.pod) newParams.pod = values.pod as string;
		if (values.labels) newParams.labels = values.labels as string;
		if (values.containername) newParams.containername = values.containername as string;
		if (values.host === 'true') newParams.host = true;
		params = newParams;
	});

	// Config object that K8sAutocomplete expects
	// Uses the mutable values object to avoid reactivity loops
	const config = $derived({
		values,
		valueHintToKey: {
			'k8s:namespace': 'namespace',
			'k8s:pod': 'pod',
			'k8s:labels': 'labels',
			'k8s:container': 'containername'
		} as Record<string, string>,
		get: (param: { key: string }) => {
			return values[param.key] || '';
		},
		set: (param: { key: string }, value: string | string[]) => {
			if (!value || value === '' || (Array.isArray(value) && value.length === 0)) {
				delete values[param.key];
			} else {
				values[param.key] = value;
			}
		},
		getAll: () => values,
		getByValueHint: (hint: string): string | undefined => {
			const key = hint.replace('k8s:', '');
			const value = values[key];
			if (Array.isArray(value)) return value.join(',');
			return value as string | undefined;
		}
	});

	// Param definitions for K8s autocomplete fields
	const namespaceParam = {
		key: 'namespace',
		title: 'Namespace',
		description: 'Kubernetes namespace to filter',
		valueHint: 'k8s:namespace'
	};

	const podParam = {
		key: 'pod',
		title: 'Pod',
		description: 'Pod name to filter',
		valueHint: 'k8s:pod'
	};

	const labelsParam = {
		key: 'labels',
		title: 'Labels',
		description: 'Pod labels to filter (key=value)',
		valueHint: 'k8s:labels'
	};
</script>

<div class="flex flex-col gap-4">
	{#if isKubernetes}
		<!-- K8s Target Fields -->
		<div class="flex flex-row items-start gap-4">
			<K8sAutocomplete param={namespaceParam} {config} />
		</div>
		<div class="flex flex-row items-start gap-4">
			<K8sAutocomplete param={podParam} {config} />
		</div>
		<div class="flex flex-row items-start gap-4">
			<K8sAutocomplete param={labelsParam} {config} />
		</div>
	{:else}
		<!-- Local (Docker/IG) Target Fields -->
		<div class="flex flex-row items-center gap-4">
			<div class="w-1/3">
				<div class="flex flex-col gap-1">
					<div class="">Container Name</div>
					<div class="mb-2 text-xs text-gray-500">Filter by container name</div>
				</div>
			</div>
			<div class="grow">
				<AutocompleteInput
					value={(values.containername as string) || ''}
					onSelect={(val) => {
						if (typeof val === 'string') values.containername = val;
					}}
					options={[]}
					placeholder="my-container"
					allowCustom={true}
					class="text-sm"
				/>
			</div>
		</div>
		<div class="flex flex-row items-center gap-4">
			<div class="w-1/3">
				<div class="flex flex-col gap-1">
					<div class="">Include Host</div>
					<div class="mb-2 text-xs text-gray-500">Also show data from the host</div>
				</div>
			</div>
			<div class="grow">
				<label class="flex cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						checked={values.host === 'true'}
						onchange={(e) => {
							values.host = e.currentTarget.checked ? 'true' : '';
						}}
						class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
					/>
					<span class="text-sm text-gray-700 dark:text-gray-300">Show host data</span>
				</label>
			</div>
		</div>
	{/if}
</div>
