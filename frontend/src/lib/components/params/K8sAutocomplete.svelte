<script lang="ts">
	import { getContext } from 'svelte';
	import Title from './Title.svelte';
	import AutocompleteInput from '$lib/components/forms/AutocompleteInput.svelte';
	import { getK8sRecents } from '$lib/utils/env-preferences';

	interface Param {
		key: string;
		title?: string;
		description?: string;
		defaultValue?: string;
		valueHint?: string;
		tags?: string[];
		prefix?: string;
	}

	interface Config {
		get: (param: Param) => string | string[];
		set: (param: Param, value: string | string[]) => void;
		getAll: () => Record<string, any>;
		getByValueHint: (valueHint: string) => string | undefined;
		valueHintToKey: Record<string, string>;
	}

	interface Props {
		param: Param;
		config: Config;
		values?: Record<string, any>;
	}

	let { param, config, values = {} }: Props = $props();

	const api: any = getContext('api');
	const environmentID = getContext<() => string | null>('environmentID');

	// Determine if this is a multi-select field
	const isMultiSelect = $derived(
		param.valueHint === 'k8s:labels' || param.valueHint === 'k8s:node-list'
	);

	// State - simplified from 7 to 5 variables
	let value = $state<string | string[]>(config.get(param) || (isMultiSelect ? [] : ''));
	let options = $state<Array<{ value: string; label?: string; isRecent?: boolean }>>([]);
	let loading = $state(false);
	let recentOptions = $state<Array<{ value: string; label?: string; isRecent?: boolean }>>([]);
	let prefetchedOptions = $state<Array<{ value: string; label?: string }>>([]);
	let lastSearchQuery = $state<string>(''); // Track last search to detect when cleared

	// Parse valueHint to determine resource type
	const resourceType = $derived(param.valueHint?.replace('k8s:', '') || '');

	// Simple dependency map
	const dependencyMap: Record<string, { depends: string[]; required: boolean }> = {
		pod: { depends: ['namespace'], required: false },
		container: { depends: ['pod', 'namespace'], required: true }
	};

	// Get dependencies for this resource type
	const dependencies = $derived.by(() => {
		const config_deps = dependencyMap[resourceType]?.depends || [];
		const deps: Record<string, string> = {};

		for (const dep of config_deps) {
			const value = config.getByValueHint(`k8s:${dep}`);
			if (value) {
				deps[dep] = value;
			}
		}

		return deps;
	});

	// Update config when value changes
	$effect(() => {
		config.set(param, value);
	});

	// Load recents on mount and when dependencies change
	$effect(() => {
		const envID = environmentID?.();
		if (!envID || !param.valueHint?.startsWith('k8s:')) return;

		// Load recent values from storage
		const recents = getK8sRecents(envID, resourceType);
		recentOptions = recents.map((v) => ({ value: v, label: v, isRecent: true }));

		// If we have dependencies, pre-fetch options
		const deps = dependencies;
		if (Object.keys(deps).length > 0) {
			prefetchOptions(deps);
		} else if (dependencyMap[resourceType]) {
			// Dependencies exist for this type but none are set - clear prefetched options
			prefetchedOptions = [];
		}
	});

	// Merge recents and prefetched/API results
	function mergeOptions(apiResults: Array<{ value: string; label?: string }>) {
		// Get unique values from recents
		const recentValues = new Set(recentOptions.map((r) => r.value));

		// Filter API results to exclude recents
		const uniqueApiResults = apiResults.filter((opt) => !recentValues.has(opt.value));

		// Calculate how many API results to show (8 total minus recents)
		const maxApiResults = Math.max(0, 8 - recentOptions.length);

		// Combine: recents first, then API results
		options = [...recentOptions, ...uniqueApiResults.slice(0, maxApiResults)];
	}

	// Fetch K8s resources from backend
	async function fetchResources(searchQuery: string = '') {
		const envID = environmentID?.();
		if (!envID) {
			loading = false;
			return;
		}

		if (!param.valueHint?.startsWith('k8s:')) {
			console.warn('[K8sAutocomplete] Invalid valueHint:', param.valueHint);
			loading = false;
			return;
		}

		// For containers, we need pod to be set
		if (resourceType === 'container') {
			const pod = config.getByValueHint('k8s:pod') || config.getByValueHint('k8s:podname');
			if (!pod) {
				// No pod selected - just show recents
				options = recentOptions;
				loading = false;
				return;
			}
		}

		loading = true;

		try {
			// Build request data
			const requestData: Record<string, any> = {
				environmentID: envID,
				resourceType,
				...dependencies
			};

			// Add search query if provided
			if (searchQuery) {
				requestData.search = searchQuery;
			}

			// Map resource types to commands
			let cmd = '';
			switch (resourceType) {
				case 'node':
				case 'node-list':
					cmd = 'getK8sNodes';
					break;
				case 'pod':
					cmd = 'getK8sPods';
					break;
				case 'namespace':
					cmd = 'getK8sNamespaces';
					break;
				case 'container':
					cmd = 'getK8sContainers';
					break;
				case 'labels':
					cmd = 'getK8sLabels';
					break;
				default:
					throw new Error(`Unknown resource type: ${resourceType}`);
			}

			console.log('[K8sAutocomplete] Fetching resources:', { cmd, requestData });

			// Add timeout
			const timeout = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Request timeout after 10 seconds')), 10000)
			);

			const response = await Promise.race([api.request({ cmd, data: requestData }), timeout]);

			console.log('[K8sAutocomplete] Response received:', response);

			// Transform response to options format
			let apiResults: Array<{ value: string; label?: string }> = [];

			if (response && response.items && Array.isArray(response.items)) {
				apiResults = response.items.map((item: any) => ({
					value: item.value || item.name || item,
					label: item.label || item.name || item.value || item
				}));
			} else if (Array.isArray(response)) {
				apiResults = response.map((item: any) => ({
					value: typeof item === 'string' ? item : item.value || item.name,
					label: typeof item === 'string' ? item : item.label || item.name || item.value
				}));
			} else {
				console.warn('[K8sAutocomplete] Unexpected response format:', response);
			}

			// Filter results if search query provided
			if (searchQuery) {
				const query = searchQuery.toLowerCase();
				apiResults = apiResults.filter((opt) => opt.label?.toLowerCase().includes(query));

				// Also filter recents
				const filteredRecents = recentOptions.filter((opt) =>
					opt.label?.toLowerCase().includes(query)
				);

				// Merge filtered recents with API results
				const recentValues = new Set(filteredRecents.map((r) => r.value));
				const uniqueApiResults = apiResults.filter((opt) => !recentValues.has(opt.value));
				const maxApiResults = Math.max(0, 8 - filteredRecents.length);

				options = [...filteredRecents, ...uniqueApiResults.slice(0, maxApiResults)];
			} else {
				// No search - merge with recents
				mergeOptions(apiResults);
			}

			console.log('[K8sAutocomplete] Options set:', options);
		} catch (err) {
			console.error('[K8sAutocomplete] Failed to fetch K8s resources:', err);
			// On error, just show recents (user might have custom values)
			options = recentOptions;
		} finally {
			loading = false;
		}
	}

	// Pre-fetch options with current dependencies
	async function prefetchOptions(deps: Record<string, string>) {
		if (!param.valueHint?.startsWith('k8s:')) return;

		const envID = environmentID?.();
		if (!envID) return;

		loading = true;

		try {
			const requestData: Record<string, any> = {
				environmentID: envID,
				resourceType,
				...deps
			};

			let cmd = '';
			switch (resourceType) {
				case 'node':
				case 'node-list':
					cmd = 'getK8sNodes';
					break;
				case 'pod':
					cmd = 'getK8sPods';
					break;
				case 'namespace':
					cmd = 'getK8sNamespaces';
					break;
				case 'container':
					cmd = 'getK8sContainers';
					break;
				case 'labels':
					cmd = 'getK8sLabels';
					break;
				default:
					return;
			}

			console.log('[K8sAutocomplete] Pre-fetching:', { cmd, requestData });

			const response = await api.request({ cmd, data: requestData });

			let apiResults: Array<{ value: string; label?: string }> = [];

			if (response && response.items && Array.isArray(response.items)) {
				apiResults = response.items.map((item: any) => ({
					value: item.value || item.name || item,
					label: item.label || item.name || item.value || item
				}));
			} else if (Array.isArray(response)) {
				apiResults = response.map((item: any) => ({
					value: typeof item === 'string' ? item : item.value || item.name,
					label: typeof item === 'string' ? item : item.label || item.name || item.value
				}));
			}

			prefetchedOptions = apiResults;
			mergeOptions(apiResults);

			console.log('[K8sAutocomplete] Pre-fetched:', prefetchedOptions.length, 'options');
		} catch (err) {
			console.error('[K8sAutocomplete] Pre-fetch failed:', err);
			// Just show recents on error
			options = recentOptions;
		} finally {
			loading = false;
		}
	}

	// Handle search input
	function handleSearch(query: string) {
		lastSearchQuery = query;

		if (query.length > 0) {
			// User is typing - fetch with search query
			fetchResources(query);
		} else {
			// Query cleared - reset to initial state (recents or prefetched)
			if (prefetchedOptions.length > 0) {
				mergeOptions(prefetchedOptions);
			} else {
				options = recentOptions;
			}
		}
	}

	// Handle selection - trigger pre-fetch for dependent fields
	function handleSelect(selectedValue: string | string[]) {
		value = selectedValue;

		// Trigger pre-fetch for dependent fields by updating the config
		// The dependent fields will react to the dependency change
		// (This happens automatically through the reactive config system)
	}

	// Handle dropdown open
	function handleOpen() {
		// Don't show dropdown if no recents and no prefetched data
		// (User should start typing first)
		if (recentOptions.length === 0 && prefetchedOptions.length === 0) {
			options = [];
			return;
		}

		// If we have pre-fetched options, merge and display them
		if (prefetchedOptions.length > 0) {
			mergeOptions(prefetchedOptions);
		} else {
			// Show recents only
			options = recentOptions;
		}
	}
</script>

<div class="w-1/3">
	<Title {param} />
</div>
<div class="grow">
	<AutocompleteInput
		bind:value
		{options}
		{loading}
		placeholder={param.defaultValue || `Select ${resourceType}...`}
		multiSelect={isMultiSelect}
		allowCustom={true}
		onSearch={handleSearch}
		onSelect={handleSelect}
		onOpen={handleOpen}
		class="text-sm"
	/>
</div>
