import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseTagInput } from '../src/tags.js';

test('normalises loosely spelled tags', () => {
  assert.equal(normaliseTagInput(' rtu-2 '), 'RTU-2');
  assert.equal(normaliseTagInput('rtu 2'), 'RTU-2');
  assert.equal(normaliseTagInput('RTU2'), 'RTU-2');
  assert.equal(normaliseTagInput('hwb-1'), 'HWB-1');
  assert.equal(normaliseTagInput(''), '');
  assert.equal(normaliseTagInput(undefined), '');
});
