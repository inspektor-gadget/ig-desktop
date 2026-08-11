/**
 * Builds the DNS map: Kubernetes-namespace-grouped workload nodes, resolver
 * nodes, and severity-aggregated workload -> resolver edges, from correlated
 * DNS transactions.
 *
 * Two-phase, both pure:
 *  1. `buildDnsMapModel` groups transactions into workloads/resolvers/edges
 *     (no positions) - this is what tests assert grouping/severity/filtering
 *     against, independent of layout.
 *  2. `layoutDnsMapModel` runs a Dagre compound layout (namespaces as
 *     parent/group nodes, matching the existing @dagrejs/dagre dependency)
 *     and returns ready-to-render XYFlow nodes/edges. There is no
 *     component-local layout state - calling this again always reproduces
 *     the same positions for the same model.
 */

import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/svelte';
import type { DnsCaptureMeta, DnsK8sRef, DnsTransaction } from './dnsTypes.ts';
import {
	summarizeDnsSeverity,
	transactionSeverity,
	slowThresholdNs,
	type DnsSeverityCounts
} from './dnsSeverity.ts';
import { primaryTime } from './dnsFormat.ts';

/** Sentinel namespace-group key for workloads with no known Kubernetes namespace (plain Docker/local captures). */
export const DNS_MAP_UNGROUPED_NAMESPACE = '\u0000ungrouped';
/** Label shown for the fallback group. */
export const DNS_MAP_UNGROUPED_LABEL = 'Other (non-Kubernetes)';

export interface DnsWorkloadModel {
	key: string;
	/** Real k8s namespace, or `DNS_MAP_UNGROUPED_NAMESPACE` when unknown. */
	namespaceKey: string;
	/** Display label for the namespace group (the namespace itself, or the fallback label). */
	namespaceLabel: string;
	podName?: string;
	/** All observed container names for this workload (sidecars share one workload key), sorted. */
	containerNames: string[];
	runtimeName?: string;
	runtimeContainerName?: string;
	runtimeContainerId?: string;
	netnsId?: string;
	/** All observed requester addresses for this workload (UDP/TCP, v4/v6), sorted. */
	addresses: string[];
	transactionIds: string[];
	counts: DnsSeverityCounts;
}

export interface DnsResolverModel {
	key: string;
	addr: string;
	port: number;
	/** Authoritative k8s enrichment (svc/pod kind+name+namespace), when known. Never guessed from the IP alone. */
	k8s?: DnsK8sRef;
	transactionIds: string[];
	counts: DnsSeverityCounts;
}

export interface DnsMapEdgeModel {
	id: string;
	workloadKey: string;
	resolverKey: string;
	/** Exact transaction IDs backing this aggregate, newest first - the modal opens exactly this set. */
	transactionIds: string[];
	/** Most recent transactions relevant to this edge's current severity (see selectEdgePreview). */
	preview: DnsTransaction[];
	counts: DnsSeverityCounts;
}

export interface DnsMapModel {
	workloads: DnsWorkloadModel[];
	resolvers: DnsResolverModel[];
	edges: DnsMapEdgeModel[];
	/** Real k8s namespaces observed (excludes the ungrouped fallback), sorted. */
	namespaces: string[];
}

interface ResolvedRequesterIdentity {
	meta?: DnsCaptureMeta;
}

/**
 * Address -> best-known requester identity, so a duplicate observation of
 * the same workload that's missing identity fields on this specific
 * transaction (e.g. captured server-side - see `resolveCaptureOwner` in
 * dnsCorrelator.ts) still aggregates into the same workload as the
 * client-side observation that does carry full pod/namespace metadata.
 * This never changes transaction identity/correlation - it only affects
 * which workload group a transaction's requester is displayed under.
 */
function buildAddressIdentityMap(
	transactions: DnsTransaction[]
): Map<string, ResolvedRequesterIdentity> {
	const map = new Map<string, ResolvedRequesterIdentity>();
	for (const txn of transactions) {
		const meta = txn.requesterMeta;
		if (meta?.namespace && meta?.podName) {
			const addr = txn.requester.addr;
			if (!map.has(addr)) map.set(addr, { meta });
		}
	}
	return map;
}

function resolveRequesterIdentity(
	txn: DnsTransaction,
	addressMap: Map<string, ResolvedRequesterIdentity>
): ResolvedRequesterIdentity {
	const meta = txn.requesterMeta;
	if (meta?.namespace && meta?.podName) return { meta };
	return addressMap.get(txn.requester.addr) ?? { meta };
}

/**
 * Workload key precedence (never falls back once a higher tier is
 * available): namespace+pod -> runtime (runtimeName + container name/id) ->
 * netns -> requester address. This is what makes UDP+TCP, sidecars, and
 * v4/v6 observations of one pod aggregate into a single workload node.
 */
function computeWorkloadKey(identity: ResolvedRequesterIdentity, requesterAddr: string): string {
	const meta = identity.meta;
	if (meta?.namespace && meta?.podName) {
		return `ns\u0001${meta.namespace}\u0001pod\u0001${meta.podName}`;
	}
	if (meta?.runtimeContainerName || meta?.runtimeContainerId) {
		return `runtime\u0001${meta.runtimeName ?? ''}\u0001${meta.runtimeContainerName ?? meta.runtimeContainerId}`;
	}
	if (meta?.netnsId) {
		return `netns\u0001${meta.netnsId}`;
	}
	return `addr\u0001${requesterAddr}`;
}

function computeResolverKey(nameserver: { addr: string; port: number }): string {
	return `${nameserver.addr}\u0001${nameserver.port}`;
}

interface WorkloadAccumulator {
	key: string;
	namespaceKey: string;
	namespaceLabel: string;
	podName?: string;
	containerNames: Set<string>;
	runtimeName?: string;
	runtimeContainerName?: string;
	runtimeContainerId?: string;
	netnsId?: string;
	addresses: Set<string>;
	transactions: DnsTransaction[];
}

interface ResolverAccumulator {
	key: string;
	addr: string;
	port: number;
	k8s?: DnsK8sRef;
	transactions: DnsTransaction[];
}

interface EdgeAccumulator {
	workloadKey: string;
	resolverKey: string;
	transactions: DnsTransaction[];
}

/**
 * Group correlated transactions into the workload/resolver/edge model. Pure
 * and total: same transactions + timeoutMs always produce the same model,
 * with no cross-call state (mirrors `computeDnsCorrelation`).
 */
export function buildDnsMapModel(transactions: DnsTransaction[], timeoutMs: number): DnsMapModel {
	const addressMap = buildAddressIdentityMap(transactions);

	const workloadAcc = new Map<string, WorkloadAccumulator>();
	const resolverAcc = new Map<string, ResolverAccumulator>();
	const edgeAcc = new Map<string, EdgeAccumulator>();

	for (const txn of transactions) {
		const identity = resolveRequesterIdentity(txn, addressMap);
		const workloadKey = computeWorkloadKey(identity, txn.requester.addr);
		const resolverKeyStr = computeResolverKey(txn.nameserver);

		let workload = workloadAcc.get(workloadKey);
		if (!workload) {
			const meta = identity.meta;
			const namespaceKey = meta?.namespace ?? DNS_MAP_UNGROUPED_NAMESPACE;
			workload = {
				key: workloadKey,
				namespaceKey,
				namespaceLabel: meta?.namespace ?? DNS_MAP_UNGROUPED_LABEL,
				podName: meta?.podName,
				containerNames: new Set(),
				runtimeName: meta?.runtimeName,
				runtimeContainerName: meta?.runtimeContainerName,
				runtimeContainerId: meta?.runtimeContainerId,
				netnsId: meta?.netnsId,
				addresses: new Set(),
				transactions: []
			};
			workloadAcc.set(workloadKey, workload);
		}
		workload.addresses.add(txn.requester.addr);
		if (identity.meta?.containerName) workload.containerNames.add(identity.meta.containerName);
		workload.transactions.push(txn);

		let resolver = resolverAcc.get(resolverKeyStr);
		if (!resolver) {
			resolver = {
				key: resolverKeyStr,
				addr: txn.nameserver.addr,
				port: txn.nameserver.port,
				k8s: txn.resolverK8s,
				transactions: []
			};
			resolverAcc.set(resolverKeyStr, resolver);
		} else if (!resolver.k8s && txn.resolverK8s) {
			resolver.k8s = txn.resolverK8s;
		}
		resolver.transactions.push(txn);

		const edgeId = `${workloadKey}\u0002${resolverKeyStr}`;
		let edge = edgeAcc.get(edgeId);
		if (!edge) {
			edge = { workloadKey, resolverKey: resolverKeyStr, transactions: [] };
			edgeAcc.set(edgeId, edge);
		}
		edge.transactions.push(txn);
	}

	const workloads: DnsWorkloadModel[] = [...workloadAcc.values()]
		.map((w) => {
			const ordered = sortNewestFirst(w.transactions);
			return {
				key: w.key,
				namespaceKey: w.namespaceKey,
				namespaceLabel: w.namespaceLabel,
				podName: w.podName,
				containerNames: [...w.containerNames].sort(),
				runtimeName: w.runtimeName,
				runtimeContainerName: w.runtimeContainerName,
				runtimeContainerId: w.runtimeContainerId,
				netnsId: w.netnsId,
				addresses: [...w.addresses].sort(),
				transactionIds: ordered.map((t) => t.id),
				counts: summarizeDnsSeverity(ordered, timeoutMs)
			};
		})
		.sort((a, b) => workloadSortLabel(a).localeCompare(workloadSortLabel(b)));

	const resolvers: DnsResolverModel[] = [...resolverAcc.values()]
		.map((r) => {
			const ordered = sortNewestFirst(r.transactions);
			return {
				key: r.key,
				addr: r.addr,
				port: r.port,
				k8s: r.k8s,
				transactionIds: ordered.map((t) => t.id),
				counts: summarizeDnsSeverity(ordered, timeoutMs)
			};
		})
		.sort((a, b) => resolverSortLabel(a).localeCompare(resolverSortLabel(b)));

	const edges: DnsMapEdgeModel[] = [...edgeAcc.values()].map((e) => {
		const ordered = sortNewestFirst(e.transactions);
		const counts = summarizeDnsSeverity(ordered, timeoutMs);
		return {
			id: `${e.workloadKey}\u0002${e.resolverKey}`,
			workloadKey: e.workloadKey,
			resolverKey: e.resolverKey,
			transactionIds: ordered.map((t) => t.id),
			preview: selectEdgePreview(ordered, counts.severity, timeoutMs),
			counts
		};
	});

	const namespaces = [
		...new Set(
			workloads.map((w) => w.namespaceKey).filter((ns) => ns !== DNS_MAP_UNGROUPED_NAMESPACE)
		)
	].sort();

	return { workloads, resolvers, edges, namespaces };
}

/** Enumerate filter options without building the resolver/edge aggregates. */
export function extractDnsMapNamespaces(transactions: DnsTransaction[]): string[] {
	const addressMap = buildAddressIdentityMap(transactions);
	const workloadKeys = new Set<string>();
	const namespaces = new Set<string>();

	for (const txn of transactions) {
		const identity = resolveRequesterIdentity(txn, addressMap);
		const workloadKey = computeWorkloadKey(identity, txn.requester.addr);
		if (workloadKeys.has(workloadKey)) continue;
		workloadKeys.add(workloadKey);
		if (identity.meta?.namespace) namespaces.add(identity.meta.namespace);
	}

	return [...namespaces].sort();
}

function sortNewestFirst(txns: DnsTransaction[]): DnsTransaction[] {
	return [...txns].sort((a, b) => (primaryTime(b) ?? 0) - (primaryTime(a) ?? 0));
}

function workloadSortLabel(w: DnsWorkloadModel): string {
	return `${w.namespaceLabel}\u0001${w.podName ?? w.runtimeContainerName ?? w.netnsId ?? w.addresses[0] ?? w.key}`;
}

function resolverSortLabel(r: DnsResolverModel): string {
	return r.k8s ? `${r.k8s.namespace ?? ''}\u0001${r.k8s.name}` : `${r.addr}:${r.port}`;
}

const DNS_MAP_EDGE_PREVIEW_COUNT = 5;

/**
 * Choose which transactions to preview on an edge card. If the edge isn't
 * healthy, prioritize the most recent transactions that actually caused its
 * highest severity (so the preview explains *why* it's flagged); otherwise
 * just show the most recent transactions overall.
 */
function selectEdgePreview(
	ordered: DnsTransaction[],
	severity: DnsSeverityCounts['severity'],
	timeoutMs: number
): DnsTransaction[] {
	if (severity === 'healthy') return ordered.slice(0, DNS_MAP_EDGE_PREVIEW_COUNT);
	const slowNs = slowThresholdNs(timeoutMs);
	const matching = ordered.filter((t) => transactionSeverity(t, slowNs) === severity);
	if (matching.length >= DNS_MAP_EDGE_PREVIEW_COUNT)
		return matching.slice(0, DNS_MAP_EDGE_PREVIEW_COUNT);
	// Fill remaining preview slots with other recent transactions (still newest-first overall).
	const matchingIds = new Set(matching.map((t) => t.id));
	const rest = ordered.filter((t) => !matchingIds.has(t.id));
	return [...matching, ...rest].slice(0, DNS_MAP_EDGE_PREVIEW_COUNT);
}

/**
 * Restrict a model to non-healthy edges only, then drop any workload/
 * resolver/namespace group left with no remaining edges. Counts on the
 * retained edges/workloads/resolvers are NOT recomputed - "Issues only" is
 * a visibility filter over the same totals computed across all in-scope
 * transactions, so e.g. "300 total / 3 failures" stays honest.
 */
export function filterDnsMapModelIssuesOnly(model: DnsMapModel): DnsMapModel {
	const edges = model.edges.filter((e) => e.counts.severity !== 'healthy');
	const workloadKeys = new Set(edges.map((e) => e.workloadKey));
	const resolverKeys = new Set(edges.map((e) => e.resolverKey));
	const workloads = model.workloads.filter((w) => workloadKeys.has(w.key));
	const resolvers = model.resolvers.filter((r) => resolverKeys.has(r.key));
	const namespaces = [
		...new Set(
			workloads.map((w) => w.namespaceKey).filter((ns) => ns !== DNS_MAP_UNGROUPED_NAMESPACE)
		)
	].sort();
	return { workloads, resolvers, edges, namespaces };
}

/**
 * Filter transactions to a single namespace *before* aggregation (honest
 * filtering: counts always reflect only in-scope transactions). Uses the
 * same address-backfill identity resolution as grouping, so the namespace
 * filter and the rendered groups always agree on which namespace a
 * transaction belongs to.
 */
export function filterTransactionsByNamespace(
	transactions: DnsTransaction[],
	namespace: string | null
): DnsTransaction[] {
	if (!namespace) return transactions;
	const addressMap = buildAddressIdentityMap(transactions);
	return transactions.filter((txn) => {
		const identity = resolveRequesterIdentity(txn, addressMap);
		return (identity.meta?.namespace ?? DNS_MAP_UNGROUPED_NAMESPACE) === namespace;
	});
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface DnsWorkloadNodeData extends Record<string, unknown> {
	workload: DnsWorkloadModel;
	onOpen: (transactionIds: string[], title?: string) => void;
}
export type DnsWorkloadNode = Node<DnsWorkloadNodeData, 'dnsWorkload'>;

export interface DnsResolverNodeData extends Record<string, unknown> {
	resolver: DnsResolverModel;
	onOpen: (transactionIds: string[], title?: string) => void;
}
export type DnsResolverNode = Node<DnsResolverNodeData, 'dnsResolver'>;

export interface DnsNamespaceGroupData extends Record<string, unknown> {
	label: string;
	fallback: boolean;
}
export type DnsNamespaceGroupNode = Node<DnsNamespaceGroupData, 'dnsNamespaceGroup'>;

export interface DnsMapEdgeData extends Record<string, unknown> {
	edge: DnsMapEdgeModel;
	onOpen: (transactionIds: string[], title?: string) => void;
}
export type DnsMapEdge = Edge<DnsMapEdgeData, 'dnsMap'>;

const WORKLOAD_WIDTH = 220;
const WORKLOAD_HEIGHT = 104;
const RESOLVER_WIDTH = 200;
const RESOLVER_HEIGHT = 84;
/** Height reserved for the namespace label inside Dagre's cluster margin. */
export const DNS_MAP_GROUP_LABEL_HEIGHT = 28;

function namespaceGroupId(namespaceKey: string): string {
	return `group\u0001${namespaceKey}`;
}
function workloadNodeId(key: string): string {
	return `workload\u0001${key}`;
}
function resolverNodeId(key: string): string {
	return `resolver\u0001${key}`;
}

/**
 * Lay out a DNS map model with Dagre's compound-graph support (namespaces
 * as parent clusters, matching the existing @dagrejs/dagre dependency - no
 * new layout library) and convert the result into XYFlow
 * nodes/edges. Deterministic: namespaces, workloads within them, and
 * resolvers are all pre-sorted by `buildDnsMapModel`, so the same model
 * always lays out identically.
 */
export function layoutDnsMapModel(
	model: DnsMapModel,
	onOpen: (transactionIds: string[], title?: string) => void
): DnsMapLayout {
	const g = new dagre.graphlib.Graph({ compound: true });
	// Vertical namespace lanes with left-to-right workload -> resolver flow.
	g.setGraph({ rankdir: 'LR', nodesep: 20, ranksep: 190, marginx: 40, marginy: 28 });
	g.setDefaultEdgeLabel(() => ({}));

	// Namespace groups (including the ungrouped fallback, only if it's actually used).
	const namespaceKeysInUse = [...new Set(model.workloads.map((w) => w.namespaceKey))].sort();
	for (const namespaceKey of namespaceKeysInUse) {
		g.setNode(namespaceGroupId(namespaceKey), {});
	}

	for (const workload of model.workloads) {
		const id = workloadNodeId(workload.key);
		g.setNode(id, { width: WORKLOAD_WIDTH, height: WORKLOAD_HEIGHT });
		g.setParent(id, namespaceGroupId(workload.namespaceKey));
	}

	for (const resolver of model.resolvers) {
		g.setNode(resolverNodeId(resolver.key), { width: RESOLVER_WIDTH, height: RESOLVER_HEIGHT });
	}

	for (const edge of model.edges) {
		g.setEdge(workloadNodeId(edge.workloadKey), resolverNodeId(edge.resolverKey));
	}

	dagre.layout(g);

	const nodes: (DnsWorkloadNode | DnsResolverNode | DnsNamespaceGroupNode)[] = [];

	// Group boxes use Dagre's own computed bounds verbatim - Dagre already
	// guarantees these don't overlap each other. Namespace labels are drawn
	// inside the natural margin Dagre leaves around each cluster's children
	// (see GROUP_LABEL_HEIGHT), not by inflating the box after the fact.
	const groupBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
	for (const namespaceKey of namespaceKeysInUse) {
		const gNode = g.node(namespaceGroupId(namespaceKey));
		const width = gNode?.width ?? 0;
		const height = gNode?.height ?? 0;
		const x = (gNode?.x ?? 0) - width / 2;
		const y = (gNode?.y ?? 0) - height / 2;
		groupBounds.set(namespaceKey, { x, y, width, height });
		nodes.push({
			id: namespaceGroupId(namespaceKey),
			type: 'dnsNamespaceGroup',
			position: { x, y },
			width,
			height,
			selectable: false,
			draggable: false,
			focusable: false,
			zIndex: -1,
			data: {
				label:
					namespaceKey === DNS_MAP_UNGROUPED_NAMESPACE ? DNS_MAP_UNGROUPED_LABEL : namespaceKey,
				fallback: namespaceKey === DNS_MAP_UNGROUPED_NAMESPACE
			}
		});
	}

	for (const workload of model.workloads) {
		const id = workloadNodeId(workload.key);
		const pos = g.node(id);
		const bounds = groupBounds.get(workload.namespaceKey);
		const absX = (pos?.x ?? 0) - WORKLOAD_WIDTH / 2;
		const absY = (pos?.y ?? 0) - WORKLOAD_HEIGHT / 2;
		nodes.push({
			id,
			type: 'dnsWorkload',
			parentId: bounds ? namespaceGroupId(workload.namespaceKey) : undefined,
			position: bounds ? { x: absX - bounds.x, y: absY - bounds.y } : { x: absX, y: absY },
			data: { workload, onOpen }
		});
	}

	for (const resolver of model.resolvers) {
		const id = resolverNodeId(resolver.key);
		const pos = g.node(id);
		nodes.push({
			id,
			type: 'dnsResolver',
			position: { x: (pos?.x ?? 0) - RESOLVER_WIDTH / 2, y: (pos?.y ?? 0) - RESOLVER_HEIGHT / 2 },
			data: { resolver, onOpen }
		});
	}

	const edges: DnsMapEdge[] = model.edges.map((edge) => ({
		id: edge.id,
		source: workloadNodeId(edge.workloadKey),
		target: resolverNodeId(edge.resolverKey),
		type: 'dnsMap',
		data: { edge, onOpen }
	}));

	return { nodes, edges };
}

export interface DnsMapLayout {
	nodes: (DnsWorkloadNode | DnsResolverNode | DnsNamespaceGroupNode)[];
	edges: DnsMapEdge[];
}

/**
 * A deterministic fingerprint of a model's *topology* (which namespace
 * groups, workloads, resolvers, and edges exist) - deliberately excludes
 * counts/severity/preview data, which change on every event batch (live
 * traffic can arrive tens of times per second) without the topology itself
 * changing. Callers use this to skip re-running Dagre (the expensive part
 * of `layoutDnsMapModel`) when only data, not topology, changed - see
 * `refreshDnsMapLayoutData`.
 */
export function dnsMapTopologyKey(model: DnsMapModel): string {
	const namespaces = [...model.namespaces].sort().join(',');
	const workloadKeys = model.workloads
		.map((w) => `${w.namespaceKey}\u0001${w.key}`)
		.sort()
		.join(',');
	const resolverKeys = model.resolvers
		.map((r) => r.key)
		.sort()
		.join(',');
	const edgeKeys = model.edges
		.map((e) => `${e.workloadKey}\u0002${e.resolverKey}`)
		.sort()
		.join(',');
	return [namespaces, workloadKeys, resolverKeys, edgeKeys].join('|');
}

/**
 * Refresh a previously-computed layout's node/edge `data` (counts,
 * previews, k8s enrichment, etc.) from a new model, WITHOUT re-running
 * Dagre - reusing every node's existing `position` verbatim. Only valid
 * when `dnsMapTopologyKey(model)` is unchanged from the model the previous
 * layout was built from (the caller is responsible for that check; this
 * function does not verify it, since it doesn't have the old model to
 * compare - see docs/DNS_MAP.md).
 *
 * Matches nodes to their new data by stable node id (`workloadNodeId`/
 * `resolverNodeId`), NOT by array position: a workload/resolver's sort
 * order can change between batches even while the topology (key *set*)
 * stays the same - e.g. authoritative resolver enrichment arriving later
 * changes `resolverSortLabel`, reordering `model.resolvers` without adding
 * or removing any resolver. Index-based matching would silently swap two
 * resolvers' data onto each other's cached positions in that case.
 */
export function refreshDnsMapLayoutData(
	previous: DnsMapLayout,
	model: DnsMapModel,
	onOpen: (transactionIds: string[], title?: string) => void
): DnsMapLayout {
	const workloadsById = new Map(model.workloads.map((w) => [workloadNodeId(w.key), w]));
	const resolversById = new Map(model.resolvers.map((r) => [resolverNodeId(r.key), r]));
	const nodes = previous.nodes.map((node) => {
		if (node.type === 'dnsWorkload') {
			const workload = workloadsById.get(node.id);
			return workload ? { ...node, data: { workload, onOpen } } : node;
		}
		if (node.type === 'dnsResolver') {
			const resolver = resolversById.get(node.id);
			return resolver ? { ...node, data: { resolver, onOpen } } : node;
		}
		// dnsNamespaceGroup: label/fallback/position never change while the
		// topology (namespace key set) is unchanged.
		return node;
	});

	const edges: DnsMapEdge[] = model.edges.map((edge) => ({
		id: edge.id,
		source: workloadNodeId(edge.workloadKey),
		target: resolverNodeId(edge.resolverKey),
		type: 'dnsMap',
		data: { edge, onOpen }
	}));

	return { nodes, edges };
}
