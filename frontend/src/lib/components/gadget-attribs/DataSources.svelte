<script lang="ts">
	import CodeIcon from '$lib/icons/code-small.svg?raw';
	import ChevronRight from '$lib/icons/chevron-right.svg?raw';
	import Eye from '$lib/icons/fa/eye.svg?raw';
	import EyeSlash from '$lib/icons/fa/eye-slash.svg?raw';
	import SearchIcon from '$lib/icons/search-small.svg?raw';
	import { preferences } from '$lib/shared/preferences.svelte.js';
	import { configuration } from '$lib/stores/configuration.svelte.js';
	import type { GadgetInfo, GadgetDatasource, GadgetDatasourceField } from '$lib/types';

	let { gadgetInfo }: { gadgetInfo: GadgetInfo } = $props();

	const imageName = $derived(gadgetInfo?.imageName ?? '');
	const showAnnotations = $derived(!!preferences.get('inspector.show-annotations'));

	// Heights for sticky positioning (must match actual rendered heights)
	const DS_HEADER_HEIGHT = 36; // Datasource header height in px (py-1.5 + content)
	const PARENT_ROW_HEIGHT = 28; // Parent field row height in px (h-7 = 28px)

	// ===== Hierarchy Building =====

	interface FieldNode {
		field: GadgetDatasourceField;
		children: FieldNode[];
	}

	function buildFieldTree(fields: GadgetDatasourceField[]): FieldNode[] {
		if (!fields?.length) return [];

		// Create index map for quick parent lookup
		const indexMap = new Map<number, GadgetDatasourceField>();
		fields.forEach((f, i) => {
			const idx = (f as { index?: number }).index ?? i;
			indexMap.set(idx, f);
		});

		// Build tree: group children under parents
		const childrenMap = new Map<number, FieldNode[]>();
		const roots: FieldNode[] = [];

		// Sort by order property if present, then by index
		const sorted = [...fields].sort((a, b) => {
			const aExt = a as { order?: number; index?: number };
			const bExt = b as { order?: number; index?: number };
			const orderA = aExt.order ?? aExt.index ?? 0;
			const orderB = bExt.order ?? bExt.index ?? 0;
			return orderA - orderB;
		});

		for (const field of sorted) {
			const node: FieldNode = { field, children: [] };
			const fieldExt = field as { parent?: number };
			if (fieldExt.parent !== undefined && indexMap.has(fieldExt.parent)) {
				// Has valid parent
				if (!childrenMap.has(fieldExt.parent)) {
					childrenMap.set(fieldExt.parent, []);
				}
				childrenMap.get(fieldExt.parent)!.push(node);
			} else {
				// Root level (no parent or parent not found - graceful handling)
				roots.push(node);
			}
		}

		// Attach children to nodes
		function attachChildren(node: FieldNode) {
			const fieldIndex = (node.field as { index?: number }).index;
			if (fieldIndex !== undefined && childrenMap.has(fieldIndex)) {
				node.children = childrenMap.get(fieldIndex)!;
				node.children.forEach(attachChildren);
			}
		}
		roots.forEach(attachChildren);

		return roots;
	}

	// ===== Collapse State Management =====

	const dsCollapseKey = $derived(`inspector.dsCollapsed:${imageName}`);
	const fieldCollapseKey = $derived(`inspector.fieldCollapsed:${imageName}`);

	let collapsedDataSources = $state<Set<string>>(new Set());
	let collapsedFields = $state<Set<string>>(new Set());

	// Initialize from stored state
	$effect(() => {
		if (imageName) {
			const stored = configuration.get(dsCollapseKey) as string[] | undefined;
			collapsedDataSources = new Set(stored || []);
		}
	});

	$effect(() => {
		if (imageName) {
			const stored = configuration.get(fieldCollapseKey) as string[] | undefined;
			collapsedFields = new Set(stored || []);
		}
	});

	// Persist on change (debounced to avoid excessive writes)
	let persistTimeout: ReturnType<typeof setTimeout>;
	$effect(() => {
		if (imageName && collapsedDataSources) {
			clearTimeout(persistTimeout);
			persistTimeout = setTimeout(() => {
				configuration.set(dsCollapseKey, Array.from(collapsedDataSources));
			}, 100);
		}
	});

	$effect(() => {
		if (imageName && collapsedFields) {
			clearTimeout(persistTimeout);
			persistTimeout = setTimeout(() => {
				configuration.set(fieldCollapseKey, Array.from(collapsedFields));
			}, 100);
		}
	});

	function toggleDataSource(dsName: string) {
		const newSet = new Set(collapsedDataSources);
		if (newSet.has(dsName)) {
			newSet.delete(dsName);
		} else {
			newSet.add(dsName);
		}
		collapsedDataSources = newSet;
	}

	function toggleField(dsName: string, fieldFullName: string) {
		const key = `${dsName}:${fieldFullName}`;
		const newSet = new Set(collapsedFields);
		if (newSet.has(key)) {
			newSet.delete(key);
		} else {
			newSet.add(key);
		}
		collapsedFields = newSet;
	}

	function isFieldCollapsed(dsName: string, fieldFullName: string): boolean {
		return collapsedFields.has(`${dsName}:${fieldFullName}`);
	}

	// ===== Visibility State =====

	function visibilityKey(dsName: string): string {
		return `columnVisibility:${imageName}:${dsName}`;
	}

	function getHiddenFields(ds: GadgetDatasource): Set<string> {
		const defaultHidden = new Set(
			(ds.fields || []).filter((f) => ((f.flags ?? 0) & 0x04) !== 0).map((f) => f.fullName)
		);

		if (!imageName) return defaultHidden;

		const key = visibilityKey(ds.name);
		const overrides = configuration.get(key) as string[] | undefined;
		if (!overrides) return defaultHidden;

		// Apply toggle logic (same as Table.svelte)
		const result = new Set(defaultHidden);
		for (const fieldName of overrides) {
			if (result.has(fieldName)) {
				result.delete(fieldName);
			} else {
				result.add(fieldName);
			}
		}
		return result;
	}

	function toggleFieldVisibility(dsName: string, fieldFullName: string) {
		if (!imageName) return;
		const key = visibilityKey(dsName);
		const overrides = new Set((configuration.get(key) as string[]) || []);
		if (overrides.has(fieldFullName)) {
			overrides.delete(fieldFullName);
		} else {
			overrides.add(fieldFullName);
		}
		configuration.set(key, Array.from(overrides));
	}

	// ===== Search =====

	let searchQuery = $state('');

	function fieldMatchesSearch(field: GadgetDatasourceField, query: string): boolean {
		if (!query) return true;
		const q = query.toLowerCase();
		return (
			field.name.toLowerCase().includes(q) ||
			field.fullName.toLowerCase().includes(q) ||
			field.annotations?.description?.toLowerCase().includes(q) ||
			Object.entries(field.annotations || {}).some(
				([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
			)
		);
	}

	function filterTree(nodes: FieldNode[], query: string): FieldNode[] {
		if (!query) return nodes;
		return nodes
			.map((node) => {
				const filteredChildren = filterTree(node.children, query);
				const selfMatches = fieldMatchesSearch(node.field, query);
				if (selfMatches || filteredChildren.length > 0) {
					return { ...node, children: filteredChildren };
				}
				return null;
			})
			.filter(Boolean) as FieldNode[];
	}

	// Auto-expand when searching
	$effect(() => {
		if (searchQuery) {
			collapsedDataSources = new Set();
			collapsedFields = new Set();
		}
	});

	// ===== Computed Trees =====

	function getFilteredTree(ds: GadgetDatasource): FieldNode[] {
		const tree = buildFieldTree(ds.fields || []);
		return filterTree(tree, searchQuery);
	}

	function countFields(ds: GadgetDatasource): number {
		return ds.fields?.length || 0;
	}

	// ===== Flag Helpers =====

	function hasFlag(flags: number, mask: number): boolean {
		return (flags & mask) !== 0;
	}

	// Calculate sticky top position based on depth
	function getStickyTop(depth: number): number {
		return DS_HEADER_HEIGHT + depth * PARENT_ROW_HEIGHT;
	}
</script>

<!-- Fixed Header (outside scroll) -->
<div class="shrink-0 border-b border-ig-border bg-ig-surface">
	<div class="flex items-center justify-between px-2 py-1.5">
		<span class="font-medium">Data Sources</span>
		<button
			title="Toggle developer mode"
			class="cursor-pointer transition-colors hover:text-ig-primary"
			class:text-ig-text-muted={!showAnnotations}
			onclick={() => {
				preferences.set('inspector.show-annotations', !showAnnotations);
			}}
		>
			{@html CodeIcon}
		</button>
	</div>
	<!-- Search Bar -->
	<div class="flex items-center gap-2 px-2 pb-1.5">
		<span class="text-ig-text-muted">{@html SearchIcon}</span>
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Search fields..."
			class="w-full rounded-ig-sm border border-ig-border-strong bg-ig-surface px-2 py-1 text-sm focus:border-ig-primary focus:outline-none"
		/>
	</div>
</div>

<!-- Scrollable Content -->
<div class="flex-1 overflow-y-auto">
	{#if gadgetInfo?.dataSources?.length}
		{#each gadgetInfo.dataSources as ds (ds.name)}
			{@const isCollapsed = collapsedDataSources.has(ds.name)}
			{@const filteredTree = getFilteredTree(ds)}
			{@const hiddenFields = getHiddenFields(ds)}

			<!-- Datasource Header (sticky at top of scroll area) -->
			<div
				class="sticky top-0 z-20 border-b border-ig-border bg-ig-surface-raised"
			>
				<button
					class="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-ig-border"
					onclick={() => toggleDataSource(ds.name)}
				>
					<span class="text-ig-text-muted transition-transform" class:rotate-90={!isCollapsed}>
						{@html ChevronRight}
					</span>
					<span class="flex-1 font-medium">{ds.name}</span>
					<span class="text-xs text-ig-text-muted">{countFields(ds)} fields</span>
				</button>
			</div>

			{#if !isCollapsed}
				<!-- Datasource Annotations (dev mode) -->
				{#if showAnnotations && ds.annotations && Object.keys(ds.annotations).length > 0}
					<div
						class="border-b border-ig-border bg-ig-surface-raised px-3 py-1 text-[9px] leading-tight"
					>
						{#each Object.entries(ds.annotations) as [key, value]}
							<div class="font-mono">
								<span class="text-ig-text-muted">{key}:</span>
								<span class="text-ig-text-secondary">{value}</span>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Hierarchical Field Tree -->
				{#if filteredTree.length > 0}
					<div class="py-1">
						{#each filteredTree as node}
							{@render fieldNode(node, 0, ds.name, hiddenFields)}
						{/each}
					</div>
				{:else if searchQuery}
					<div class="px-4 py-3 text-sm text-ig-text-muted">No matching fields</div>
				{/if}
			{/if}
		{/each}
	{:else}
		<div class="p-4 text-center text-sm text-ig-text-muted">No data sources available</div>
	{/if}
</div>

{#snippet fieldNode(node: FieldNode, depth: number, dsName: string, hiddenFields: Set<string>)}
	{@const isHidden = hiddenFields.has(node.field.fullName)}
	{@const hasChildren = node.children.length > 0}
	{@const isExpanded = !isFieldCollapsed(dsName, node.field.fullName)}
	{@const stickyTop = getStickyTop(depth)}
	{@const zIndex = 10 + depth}

	{#if hasChildren}
		<!-- Parent field with children - sticky, fixed height like VS Code fold headers -->
		<div
			class="sticky h-7 overflow-hidden border-b border-ig-border bg-ig-surface"
			style="top: {stickyTop}px; z-index: {zIndex};"
		>
			<div class="flex h-full items-center gap-1" style="padding-left: {depth * 16 + 8}px">
				<!-- Collapse toggle -->
				<button
					class="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center text-ig-text-muted transition-colors hover:text-ig-text-secondary"
					class:rotate-90={isExpanded}
					onclick={() => toggleField(dsName, node.field.fullName)}
					title={isExpanded ? 'Collapse' : 'Expand'}
				>
					<span class="scale-[0.6]">{@html ChevronRight}</span>
				</button>

				<!-- Visibility toggle -->
				<button
					class="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center transition-colors"
					class:text-gray-300={isHidden}
					class:dark:text-gray-600={isHidden}
					class:text-ig-primary={!isHidden}
					onclick={() => toggleFieldVisibility(dsName, node.field.fullName)}
					title={isHidden ? 'Show column' : 'Hide column'}
				>
					{#if isHidden}
						<span class="scale-[0.6]">{@html EyeSlash}</span>
					{:else}
						<span class="scale-[0.6]">{@html Eye}</span>
					{/if}
				</button>

				<!-- Field info - compact single line for sticky header -->
				<div class="flex min-w-0 flex-1 items-center gap-1.5">
					<span class="truncate font-mono text-xs" class:text-ig-text-muted={isHidden}>
						{node.field.name}
					</span>
					{#if node.field.kind}
						<span class="shrink-0 text-[10px] text-ig-text-muted"
							>{node.field.kind}</span
						>
					{/if}
					{#if node.field.annotations?.description}
						<span class="truncate text-[10px] text-ig-text-muted"
							>— {node.field.annotations.description}</span
						>
					{/if}
					<span class="shrink-0 text-[10px] text-ig-text-muted"
						>({node.children.length})</span
					>
				</div>
			</div>
		</div>
	{:else}
		<!-- Leaf field - not sticky -->
		<div
			class="flex items-center gap-1 py-0.5 transition-colors hover:bg-ig-border"
			style="padding-left: {depth * 16 + 8}px"
		>
			<!-- Spacer for alignment -->
			<div class="w-3.5"></div>

			<!-- Visibility toggle -->
			<button
				class="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center transition-colors"
				class:text-gray-300={isHidden}
				class:dark:text-gray-600={isHidden}
				class:text-ig-primary={!isHidden}
				onclick={() => toggleFieldVisibility(dsName, node.field.fullName)}
				title={isHidden ? 'Show column' : 'Hide column'}
			>
				{#if isHidden}
					<span class="scale-[0.6]">{@html EyeSlash}</span>
				{:else}
					<span class="scale-[0.6]">{@html Eye}</span>
				{/if}
			</button>

			<!-- Field info -->
			<div class="min-w-0 flex-1">
				{@render fieldInfo(node, isHidden)}
			</div>
		</div>
	{/if}

	<!-- Render children if expanded -->
	{#if hasChildren && isExpanded}
		{#each node.children as child}
			{@render fieldNode(child, depth + 1, dsName, hiddenFields)}
		{/each}
	{/if}
{/snippet}

{#snippet fieldInfo(node: FieldNode, isHidden: boolean)}
	<!-- User mode: name, type, description -->
	<div class="flex items-center gap-1.5">
		<span class="truncate font-mono text-xs" class:text-ig-text-muted={isHidden}>
			{node.field.name}
		</span>
		{#if node.field.kind}
			<span class="shrink-0 text-[10px] text-ig-text-muted">{node.field.kind}</span>
		{/if}
		{#if node.field.annotations?.description}
			<span class="truncate text-[10px] text-ig-text-muted"
				>— {node.field.annotations.description}</span
			>
		{/if}
	</div>

	<!-- Dev mode: tags, annotations, flags -->
	{#if showAnnotations}
		<!-- Tags -->
		{#if node.field.tags?.length}
			<div class="mt-0.5 flex flex-wrap gap-0.5">
				{#each node.field.tags as tag}
					<span class="rounded-ig-sm bg-ig-surface-raised px-1 py-0 text-[9px]">{tag}</span>
				{/each}
			</div>
		{/if}

		<!-- Flags -->
		{@const flags = node.field.flags || 0}
		{#if flags !== 0}
			<div class="mt-0.5 flex flex-wrap gap-0.5">
				{#if hasFlag(flags, 0x01)}
					<span class="rounded-ig-sm bg-ig-surface-raised px-1 py-0 text-[9px]">empty</span>
				{/if}
				{#if hasFlag(flags, 0x02)}
					<span class="rounded-ig-sm bg-green-200/60 px-1 py-0 text-[9px] dark:bg-green-800/60"
						>container</span
					>
				{/if}
				{#if hasFlag(flags, 0x04)}
					<span class="rounded-ig-sm bg-ig-surface-raised px-1 py-0 text-[9px]">hidden</span
					>
				{/if}
				{#if hasFlag(flags, 0x08)}
					<span class="rounded-ig-sm bg-blue-200/60 px-1 py-0 text-[9px] dark:bg-blue-800/60"
						>w-parent</span
					>
				{/if}
				{#if hasFlag(flags, 0x10)}
					<span class="rounded-ig-sm bg-orange-200/60 px-1 py-0 text-[9px] dark:bg-orange-800/60"
						>static</span
					>
				{/if}
				{#if hasFlag(flags, 0x20)}
					<span class="rounded-ig-sm bg-red-200/60 px-1 py-0 text-[9px] dark:bg-red-800/60">unref</span>
				{/if}
			</div>
		{/if}

		<!-- Annotations -->
		{#if node.field.annotations && Object.keys(node.field.annotations).length > 0}
			<div class="mt-0.5 text-[9px] leading-tight">
				{#each Object.entries(node.field.annotations).filter(([k]) => k !== 'description') as [k, v]}
					<div class="font-mono">
						<span class="text-ig-text-muted">{k}:</span>
						<span class="text-ig-text-muted">{v}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}
