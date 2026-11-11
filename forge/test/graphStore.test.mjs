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

test('siteForAction: ambiguous → asks which site, naming each with its space', () => {
  assert.throws(() => siteForAction([a, b], undefined), /Which site\?.*Example Office Building \(FAC\), Example Office Building \(2\) \(OPS\)/);
});

test('siteForAction: a site name or space key picks among several', () => {
  assert.equal(siteForAction([a, b], undefined, 'ops'), b);
  assert.equal(siteForAction([a, b], undefined, '(2)'), b);
  assert.equal(siteForAction([a, b], 'FAC', 'ops'), b, 'an explicit site wins over the space context');
  assert.throws(() => siteForAction([a, b], undefined, 'nowhere'), /No Precedent site matches "nowhere"/);
});

test('factsOf keeps provenance', () => {
  const n = { id: 'breaker:RTU-2', type: 'Breaker', name: 'x', attrs: { ratingA: { value: 250, provenance: 'illustrative', source: 's' } } };
  assert.deepEqual(factsOf(n), { id: 'breaker:RTU-2', type: 'Breaker', name: 'x', facts: n.attrs });
  assert.equal(factsOf(undefined), null);
});
