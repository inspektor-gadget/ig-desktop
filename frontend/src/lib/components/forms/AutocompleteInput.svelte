<script lang="ts">
	import { tick } from 'svelte';

	interface Option {
		value: string;
		label?: string;
		isRecent?: boolean;
	}

	interface Props {
		value?: string | string[];
		options?: Option[];
		placeholder?: string;
		disabled?: boolean;
		error?: string;
		label?: string;
		description?: string;
		required?: boolean;
		multiSelect?: boolean;
		loading?: boolean;
		onSearch?: (query: string) => void;
		onSelect?: (value: string | string[]) => void;
		onOpen?: () => void;
		onEnter?: () => void;
		class?: string;
		allowCustom?: boolean;
	}

	let {
		value = $bindable(''),
		options = [],
		placeholder = '',
		disabled = false,
		error = '',
		label = '',
		description = '',
		required = false,
		multiSelect = false,
		loading = false,
		onSearch = undefined,
		onSelect = undefined,
		onOpen = undefined,
		onEnter = undefined,
		class: className = '',
		allowCustom = true
	}: Props = $props();

	let searchQuery = $state('');
	let isOpen = $state(false);
	let highlightedIndex = $state(0);
	let inputRef: HTMLInputElement;
	let dropdownRef: HTMLDivElement;

	// Convert value to array for consistent handling
	const selectedValues = $derived(
		multiSelect ? (Array.isArray(value) ? value : value ? [value] : []) : []
	);

	// For single-select, show the selected value label when not searching
	const displayValue = $derived(() => {
		if (multiSelect) return searchQuery;
		if (isOpen) return searchQuery;
		if (!value || Array.isArray(value)) return '';
		return getLabel(value as string);
	});

	// Get display label for a value
	function getLabel(val: string): string {
		const option = options.find((opt) => opt.value === val);
		return option?.label || val;
	}

	// Filter options based on search query
	const filteredOptions = $derived(() => {
		if (!searchQuery) return options;
		const query = searchQuery.toLowerCase();
		return options.filter((opt) => {
			const label = opt.label || opt.value;
			return label.toLowerCase().includes(query);
		});
	});

	// Close dropdown if search is empty and no options available
	$effect(() => {
		// If dropdown is open, search query is empty, and there are no options, close it
		if (isOpen && searchQuery === '' && options.length === 0 && !loading) {
			isOpen = false;
		}
	});

	// Handle input changes
	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;

		// Update value as user types (for custom input)
		if (allowCustom && !multiSelect) {
			value = searchQuery;
			if (onSelect) onSelect(searchQuery);
		}

		if (onSearch) {
			onSearch(searchQuery);
		}

		if (!isOpen && searchQuery) {
			isOpen = true;
			highlightedIndex = 0;
		}
	}

	// Handle option selection
	function selectOption(optionValue: string) {
		if (multiSelect) {
			const current = Array.isArray(value) ? value : value ? [value] : [];
			const newValues = current.includes(optionValue)
				? current.filter((v) => v !== optionValue)
				: [...current, optionValue];
			value = newValues;
			if (onSelect) onSelect(newValues);
		} else {
			// In single-select, always set the value (don't toggle)
			value = optionValue;
			if (onSelect) onSelect(optionValue);
			searchQuery = '';
			isOpen = false;
		}
	}

	// Clear the selection
	function clearSelection(e: Event) {
		e.stopPropagation();
		e.preventDefault();
		value = multiSelect ? [] : '';
		if (onSelect) onSelect(multiSelect ? [] : '');
		searchQuery = '';
		isOpen = false;
		// Don't focus the input to prevent dropdown from reopening
	}

	// Remove tag in multi-select mode
	function removeTag(tagValue: string) {
		if (multiSelect && Array.isArray(value)) {
			const newValues = value.filter((v) => v !== tagValue);
			value = newValues;
			if (onSelect) onSelect(newValues);
		}
	}

	// Handle keyboard navigation
	async function handleKeyDown(e: KeyboardEvent) {
		const filtered = filteredOptions();

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				if (!isOpen) {
					isOpen = true;
					highlightedIndex = 0;
				} else {
					highlightedIndex = Math.min(highlightedIndex + 1, filtered.length - 1);
					await tick();
					scrollToHighlighted();
				}
				break;

			case 'ArrowUp':
				e.preventDefault();
				if (isOpen) {
					highlightedIndex = Math.max(highlightedIndex - 1, 0);
					await tick();
					scrollToHighlighted();
				}
				break;

			case 'Enter':
				e.preventDefault();
				if (isOpen && filtered.length > 0 && highlightedIndex < filtered.length) {
					// Select from dropdown
					selectOption(filtered[highlightedIndex].value);
				}
				// Always trigger onEnter if it exists (value is already set from typing)
				if (onEnter) {
					onEnter();
				}
				break;

			case 'Escape':
				e.preventDefault();
				isOpen = false;
				searchQuery = '';
				break;

			case 'Backspace':
				if (multiSelect && !searchQuery && selectedValues.length > 0) {
					removeTag(selectedValues[selectedValues.length - 1]);
				}
				break;
		}
	}

	// Scroll highlighted option into view
	function scrollToHighlighted() {
		if (!dropdownRef) return;
		const highlighted = dropdownRef.querySelector('[data-highlighted="true"]');
		if (highlighted) {
			highlighted.scrollIntoView({ block: 'nearest' });
		}
	}

	// Handle blur event (close dropdown)
	function handleBlur(e: FocusEvent) {
		// Check if the new focus target is within the component
		const relatedTarget = e.relatedTarget as HTMLElement;
		if (!relatedTarget || !dropdownRef?.contains(relatedTarget)) {
			// Use a shorter timeout for better responsiveness
			setTimeout(() => {
				isOpen = false;
				searchQuery = '';
			}, 100);
		}
	}

	// Handle focus event
	function handleFocus() {
		// Initialize search query with current value to allow editing
		if (!multiSelect && value && typeof value === 'string') {
			searchQuery = value;
		} else {
			searchQuery = '';
		}
		// Notify parent that dropdown is being opened
		if (onOpen) onOpen();
		// Always open dropdown on focus if we have options or are loading
		if (options.length > 0 || loading) {
			isOpen = true;
		}
	}

	// Handle click on input
	function handleInputClick() {
		// Don't open if disabled or already open
		if (disabled || isOpen) return;

		// Initialize search query with current value to allow editing
		if (!multiSelect && value && typeof value === 'string') {
			searchQuery = value;
		} else {
			searchQuery = '';
		}
		// Notify parent that dropdown is being opened
		if (onOpen) onOpen();
		// Open dropdown on click only if we have options or are loading
		if (options.length > 0 || loading) {
			isOpen = true;
		}
	}
</script>

<div class="flex flex-col gap-1 {className}">
	{#if label}
		<label class="text-sm font-medium text-gray-200">
			{label}
			{#if required}
				<span class="text-red-500">*</span>
			{/if}
		</label>
	{/if}

	{#if description}
		<p class="text-sm text-gray-400">{description}</p>
	{/if}

	<div class="relative">
		<!-- Input container with tags for multi-select -->
		<div
			class="flex min-h-[42px] flex-wrap items-center gap-2 rounded-lg border bg-gray-900 px-3 py-2 transition-colors {error
				? 'border-red-500'
				: 'border-gray-700 focus-within:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500/20'} {disabled
				? 'cursor-not-allowed opacity-50'
				: ''}"
		>
			{#if multiSelect}
				{#each selectedValues as tag}
					<span
						class="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200"
					>
						{getLabel(tag)}
						{#if !disabled}
							<button
								type="button"
								onclick={() => removeTag(tag)}
								class="text-gray-400 transition-colors hover:text-gray-200"
							>
								<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						{/if}
					</span>
				{/each}
			{/if}

			<input
				bind:this={inputRef}
				type="text"
				value={displayValue()}
				{placeholder}
				{disabled}
				{required}
				oninput={handleInput}
				onkeydown={handleKeyDown}
				onfocus={handleFocus}
				onblur={handleBlur}
				onclick={handleInputClick}
				class="min-w-[100px] flex-1 border-none bg-transparent text-gray-200 placeholder-gray-500 outline-none"
				autocomplete="off"
			/>

			{#if !loading && !disabled && value && ((!multiSelect && value !== '') || (multiSelect && Array.isArray(value) && value.length > 0))}
				<button
					type="button"
					onclick={clearSelection}
					class="flex-shrink-0 text-gray-400 transition-colors hover:text-gray-200"
					title="Clear selection"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			{/if}

			{#if loading}
				<svg class="h-4 w-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					/>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					/>
				</svg>
			{/if}
		</div>

		<!-- Dropdown -->
		{#if isOpen && !disabled && filteredOptions().length > 0}
			<div
				bind:this={dropdownRef}
				class="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-700 bg-gray-900 shadow-lg"
			>
				{#each filteredOptions() as option, index}
					{@const isSelected = multiSelect
						? selectedValues.includes(option.value)
						: value === option.value}
					{@const isHighlighted = index === highlightedIndex}
					<button
						type="button"
						data-highlighted={isHighlighted}
						onmousedown={(e) => {
							e.preventDefault();
							selectOption(option.value);
						}}
						class="w-full px-4 py-2 text-left transition-colors {isHighlighted
							? 'bg-gray-800'
							: 'hover:bg-gray-800'} {isSelected ? 'text-blue-400' : 'text-gray-200'}"
					>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								{#if option.isRecent}
									<svg
										class="h-3.5 w-3.5 text-gray-500"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
								{/if}
								<span>{option.label || option.value}</span>
							</div>
							{#if isSelected}
								<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
									<path
										fill-rule="evenodd"
										d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
										clip-rule="evenodd"
									/>
								</svg>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if error}
		<p class="text-sm text-red-500">{error}</p>
	{/if}
</div>
