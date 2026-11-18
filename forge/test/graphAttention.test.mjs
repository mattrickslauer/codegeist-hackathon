import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { panelLoads, siteAttention } from '../src/graphAttention.js';

const require = createRequire(import.meta.url);
const seed = require('../src/seed/exb-graph.json');

const tiny = {
  nodes: [
    { id: 'panel:P', type: 'Panel', name: 'P', attrs: { busA: { value: 100, provenance: 'illustrative' } } },
    { id: 'breaker:A', type: 'Breaker', name: 'A', attrs: { ratingA: { value: 50 } } },
    { id: 'breaker:B', type: 'Breaker', name: 'B', attrs: { ratingA: { value: 40 } } },
    { id: 'feeder:A', type: 'Feeder', name: 'fa', attrs: {} },
    { id: 'eq:RTU-1', type: 'Equipment', name: 'RTU-1', attrs: {} },
    { id: 'eq:RTU-2', type: 'Equipment', name: 'RTU-2', attrs: {} },
  ],
  links: [
    { from: 'panel:P', to: 'breaker:A', type: 'feeds' },
    { from: 'panel:P', to: 'breaker:B', type: 'feeds' },
    { from: 'breaker:A', to: 'feeder:A', type: 'feeds' },
    { from: 'feeder:A', to: 'eq:RTU-1', type: 'feeds' },
    { from: 'breaker:B', to: 'eq:RTU-2', type: 'feeds' },
  ],
};

test('panelLoads sums breaker ratings against the bus and finds the equipment fed', () => {
  const [p] = panelLoads(tiny);
  assert.equal(p.connectedA, 90);
  assert.equal(p.ratio, 0.9);
  assert.deepEqual(p.equipment.sort(), ['RTU-1', 'RTU-2']);
  assert.equal(p.provenance, 'illustrative');
});

test('the sample building has one panel near capacity (the deliberate RTU-2 tight spot)', () => {
  const near = panelLoads(seed).filter((p) => p.ratio >= 0.8);
  assert.equal(near.length, 1);
  assert.ok(near[0].equipment.includes('RTU-2'));
});

test('siteAttention orders blocked, approvals, capacity and ranks node status', () => {
  const orders = [
    { key: 'FAC-1', summary: 'Shut down RTU-1', check: { status: 'conflict', conflicts: [{ statement: 'No weekday shutdowns', matched: ['RTU-1'] }] } },
    { key: 'FAC-2', summary: 'Clear one', check: { status: 'clear', conflicts: [] } },
    { key: 'FAC-3', summary: 'Never checked', check: null },
  ];
  const decisions = [
    { id: 'd1', status: 'standing', equipment: ['RTU-1', 'RTU-2'], statement: 's' },
    { id: 'd2', status: 'proposed', equipment: ['RTU-2'], statement: 'p' },
    { id: 'd3', status: 'withdrawn', equipment: ['RTU-2'], statement: 'w' },
  ];
  const r = siteAttention({ graph: tiny, decisions, orders });
  assert.deepEqual(r.items.map((i) => i.kind), ['blocked', 'approval', 'capacity']);
  assert.equal(r.items[0].detail, 'No weekday shutdowns');
  assert.equal(r.nodeStatus.get('eq:RTU-1'), 'blocked');
  assert.equal(r.nodeStatus.get('eq:RTU-2'), 'approval');
  assert.equal(r.nodeStatus.get('panel:P'), 'capacity');
});

test('siteAttention copes with missing data', () => {
  const r = siteAttention({ graph: null, decisions: null, orders: null });
  assert.deepEqual(r.items, []);
  assert.equal(r.nodeStatus.size, 0);
});
