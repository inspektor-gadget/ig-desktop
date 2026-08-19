import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVisualizerExcluded } from './visualizerConfig.ts';

test('visualizers.exclude accepts comma-separated visualizer IDs', () => {
	const annotations = { 'visualizers.exclude': 'networkmap, dns-transactions' };

	assert.equal(isVisualizerExcluded(annotations, 'networkmap'), true);
	assert.equal(isVisualizerExcluded(annotations, 'dns-transactions'), true);
	assert.equal(isVisualizerExcluded(annotations, 'dns-network'), false);
});
