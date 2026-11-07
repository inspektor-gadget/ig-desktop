import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overrideStack } from './override-stack.ts';

test('cleanup removes only its own override, in any order', () => {
	const changes: Array<string | undefined> = [];
	const stack = overrideStack<string>((current) => changes.push(current));
	const restoreA = stack.push('a');
	const restoreB = stack.push('b');
	assert.equal(stack.current, 'b');
	restoreA();
	assert.equal(stack.current, 'b');
	restoreB();
	assert.equal(stack.current, undefined, 'the disposed override is not reinstalled');
	restoreB();
	const restoreC = stack.push('c');
	const restoreD = stack.push('d');
	restoreD();
	assert.equal(stack.current, 'c');
	restoreC();
	assert.deepEqual(changes, ['a', 'b', 'b', undefined, 'c', 'd', 'c', undefined]);
});
