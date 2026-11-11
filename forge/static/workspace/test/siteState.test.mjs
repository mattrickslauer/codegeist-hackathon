// Run: npm test (in forge/static/workspace)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSiteState, normaliseCheck } from '../src/siteState.js';

const decision = { id: 'd1', status: 'standing', equipment: ['RTU-1'] };

test('legacy precedent.check (spike-3 test format, no conflicts list) does not crash', () => {
  // Exactly what FAC-272 / FAC-278 carried on 2026-11-11 and what crashed the site page.
  const legacy = { status: 'conflict', summary: 'Bypass valve V-12 stays locked open', decidedBy: 'x', decidedAt: '2026-03-03', source: 'spike-3' };
  const orders = [{ key: 'FAC-272', check: normaliseCheck(legacy) }];
  const state = deriveSiteState([decision], orders);
  assert.equal(state.blockedOrders.length, 1);
  assert.deepEqual(state.highlights, { 'RTU-1': 'decision' });
});

test('normaliseCheck fills every list and keeps known fields', () => {
  assert.equal(normaliseCheck(null), null);
  assert.equal(normaliseCheck('garbage'), null);
  const n = normaliseCheck({ status: 'conflict', conflicts: [{ matched: ['HWB-1'] }] });
  assert.deepEqual(n.touched, []);
  assert.deepEqual(n.acknowledged, []);
  assert.deepEqual(n.conflicts[0].matched, ['HWB-1']);
  assert.deepEqual(normaliseCheck({ status: 'conflict', conflicts: [{}] }).conflicts[0].matched, []);
});

test('current-format conflicts colour their equipment red, decisions blue', () => {
  const orders = [{ key: 'FAC-300', check: normaliseCheck({ status: 'conflict', touched: ['HWB-1'], conflicts: [{ matched: ['HWB-1'] }] }) }];
  const state = deriveSiteState([decision, { id: 'd2', status: 'standing', equipment: ['HWB-1', 'HWB-2'] }], orders);
  assert.deepEqual(state.highlights, { 'RTU-1': 'decision', 'HWB-1': 'blocked', 'HWB-2': 'decision' });
});

test('missing decisions/orders (still loading) give an empty state', () => {
  const state = deriveSiteState(null, null);
  assert.deepEqual(state, { standing: [], blockedOrders: [], highlights: {} });
});
