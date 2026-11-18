import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scenePositions, schematicLayout, visibleSubgraph } from '../src/systems/layout.js';
import { nextTag, defaultLinkType } from '../src/systems/addHelpers.js';

const seed = JSON.parse(readFileSync(new URL('../../../src/seed/exb-graph.json', import.meta.url), 'utf8'));

test('schematic: sources left of loads, every visible node placed', () => {
  const v = visibleSubgraph(seed, null);
  const { pos, layer } = schematicLayout(v.nodes, v.links);
  assert.equal(pos.size, v.nodes.length);
  assert.ok(layer.get('switchboard:MSB') < layer.get('panel:RDP-N'));
  assert.ok(layer.get('panel:RDP-N') < layer.get('breaker:RTU-1'));
  assert.ok(layer.get('disconnect:RTU-1') < layer.get('equipment:RTU-1'));
  assert.ok(pos.get('switchboard:MSB').x < pos.get('equipment:RTU-1').x);
});

test('system filter keeps only that system (and drops filing-only levels)', () => {
  const v = visibleSubgraph(seed, new Set(['refrigerant']));
  assert.ok(v.links.length > 0);
  assert.ok(v.links.every((l) => l.type === 'connects'));
  assert.ok(!v.nodes.some((n) => n.type === 'Level'));
});

test('3D anchors: model tags, explicit placement, and floating above the roof for the rest', () => {
  const tagCentres = new Map([['RTU-1', { x: 10, y: 20, z: 5 }]]);
  const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 40, y: 20, z: 30 } };
  const g = { ...seed, nodes: seed.nodes.map((n) => (n.id === 'curb:RTU-2' ? { ...n, pos: { x: 1, y: 2, z: 3 } } : n)) };
  const a = scenePositions(g, tagCentres, bounds);
  assert.equal(a.get('equipment:RTU-1').placed, 'model');
  assert.deepEqual(a.get('curb:RTU-2'), { x: 1, y: 2, z: 3, placed: 'set' });
  const d = a.get('disconnect:RTU-1');
  assert.equal(d.placed, 'floating');
  assert.ok(d.y > bounds.max.y, 'floats above the roof');
  assert.ok(a.get('switchboard:MSB').y > d.y, 'further upstream floats higher');
  assert.equal(a.size, g.nodes.length);
});

test('next tag continues a series; link type follows the components', () => {
  const g = { nodes: [{ name: 'V-12' }, { name: 'V-3' }, { name: 'CHWP-1' }] };
  assert.equal(nextTag(g, 'Valve', 'V-12'), 'V-13');
  assert.equal(nextTag(g, 'Valve'), 'V-13');
  assert.equal(nextTag(g, 'Pump', 'CHWP-1'), 'CHWP-2');
  assert.equal(nextTag(g, 'Breaker'), 'CB-1');
  assert.equal(defaultLinkType({ type: 'Panel' }, { type: 'Breaker' }), 'feeds');
  assert.equal(defaultLinkType({ type: 'Pump' }, { type: 'Valve' }, 'chw'), 'flowsTo');
  assert.equal(defaultLinkType({ type: 'Equipment' }, { type: 'ServedArea' }, 'chw'), 'serves');
  assert.equal(defaultLinkType({ type: 'Equipment' }, { type: 'Curb' }), 'supportedBy');
});
