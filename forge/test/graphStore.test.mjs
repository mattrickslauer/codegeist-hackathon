import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factsOf, graphKey, siteForAction } from '../src/graphKeys.js';

const a = { id: 'a', name: 'Example Office Building', space: { key: 'FAC' } };
const b = { id: 'b', name: 'Example Office Building (2)', space: { key: 'OPS' } };

test('graphKey', () => {
  assert.equal(graphKey('abc'), 'graph:abc');
});

test('siteForAction picks the site linked to the work order space', () => {
  assert.equal(siteForAction([a, b], 'OPS'), b);
});

test('siteForAction falls back to the only site', () => {
  assert.equal(siteForAction([a], 'XYZ'), a);
  assert.equal(siteForAction([a], undefined), a);
});

test('siteForAction: no graph sites → null (bundled sample)', () => {
  assert.equal(siteForAction([], 'FAC'), null);
});

test('siteForAction: ambiguous → asks which site', () => {
  assert.throws(() => siteForAction([a, b], undefined), /Which site\?.*Example Office Building, Example Office Building \(2\)/);
});

test('factsOf keeps provenance', () => {
  const n = { id: 'breaker:RTU-2', type: 'Breaker', name: 'x', attrs: { ratingA: { value: 250, provenance: 'illustrative', source: 's' } } };
  assert.deepEqual(factsOf(n), { id: 'breaker:RTU-2', type: 'Breaker', name: 'x', facts: n.attrs });
  assert.equal(factsOf(undefined), null);
});
