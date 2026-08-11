import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHandleType, shouldReverseByPort } from './portDirection.ts';

test('port direction normalizes low-to-high responses only while collapsing high ports', () => {
	assert.equal(shouldReverseByPort(53, 32768, 32768), true);
	assert.equal(shouldReverseByPort(32768, 53, 32768), false);
	assert.equal(shouldReverseByPort(53, 443, 32768), false);
	assert.equal(shouldReverseByPort(40000, 50000, 32768), false);
	assert.equal(shouldReverseByPort(undefined, 40000, 32768), false);
	assert.equal(shouldReverseByPort(53, 40000, 0), false);
});

test('handle type records every side used by its edges', () => {
	assert.equal(mergeHandleType('source', 'source'), 'source');
	assert.equal(mergeHandleType('target', 'source'), 'both');
	assert.equal(mergeHandleType('both', 'target'), 'both');
});
