import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkEdge, NetworkNode } from '../../types/networkmap.ts';
import {
	layoutNetworkMap,
	networkMapTopologyKey,
	networkNodeNamespace
} from '../networkMapLayout.ts';

function node(id: string, namespace?: string): NetworkNode {
	return {
		id,
		type: 'address',
		position: { x: 0, y: 0 },
		data: {
			addr: id,
			label: id,
			labels: [
				...(namespace ? [{ field: 'namespace', value: namespace }] : []),
				{ field: 'addr', value: id }
			],
			handles: [],
			connectionCount: 1,
			isActive: false,
			lastSeen: 0
		}
	};
}

test('namespace groups are left-aligned and stacked vertically', () => {
	const nodes = [node('frontend', 'default'), node('api', 'default'), node('dns', 'kube-system')];
	const edges: NetworkEdge[] = [
		{
			id: 'frontend-api',
			source: 'frontend',
			target: 'api',
			data: { count: 1, lastSeen: 0, isActive: false }
		}
	];

	const layout = layoutNetworkMap(nodes, edges);
	const groups = layout.nodes.filter((candidate) => candidate.type === 'networkNamespaceGroup');
	assert.deepEqual(
		groups.map((group) => group.data.label),
		['default', 'kube-system']
	);
	assert.equal(groups[0].position.x, groups[1].position.x);
	assert.ok(groups[1].position.y > groups[0].position.y);
	assert.equal(
		layout.nodes.find((candidate) => candidate.id === 'frontend')?.parentId,
		groups[0].id
	);
	assert.ok(
		layout.nodes.find((candidate) => candidate.id === 'api')!.position.x >
			layout.nodes.find((candidate) => candidate.id === 'frontend')!.position.x
	);
});

test('nodes without namespace enrichment remain ungrouped', () => {
	const external = node('8.8.8.8');
	const layout = layoutNetworkMap([external], []);
	assert.equal(networkNodeNamespace(external), undefined);
	assert.equal(layout.nodes[0].parentId, undefined);
});

test('cross-namespace edges preserve global left-to-right ranks', () => {
	const source = node('frontend', 'default');
	const target = node('dns', 'kube-system');
	const edge: NetworkEdge = {
		id: 'frontend-dns',
		source: source.id,
		target: target.id,
		data: { count: 1, lastSeen: 0, isActive: false }
	};
	const layout = layoutNetworkMap([source, target], [edge]);
	assert.ok(
		layout.nodes.find((candidate) => candidate.id === target.id)!.position.x >
			layout.nodes.find((candidate) => candidate.id === source.id)!.position.x
	);
});

test('node height changes invalidate the cached layout', () => {
	const workload = node('frontend', 'default');
	const initialKey = networkMapTopologyKey([workload]);

	workload.data.handles.push({
		id: 'TCP:80',
		proto: 'TCP',
		port: 80,
		type: 'target',
		connectionCount: 1,
		isActive: false,
		lastSeen: 0
	});
	assert.notEqual(networkMapTopologyKey([workload]), initialKey);
});
