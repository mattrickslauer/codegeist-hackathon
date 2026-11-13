import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOps, newGraph, newNodeId } from '../src/graphEdit.js';

const seed = JSON.parse(readFileSync(new URL('../src/seed/exb-graph.json', import.meta.url), 'utf8'));
const NOW = '2026-11-13T10:00:00.000Z';

test('add a pump, a valve and a pipe between them; values are entered with who and when', () => {
  const { graph, inverse, touched } = applyOps(seed, [
    { op: 'addNode', node: { type: 'Pump', name: 'HWP-1', system: 'hhw', attrs: { flowGpm: '120', hp: 5 } } },
    { op: 'addNode', node: { type: 'Valve', name: 'V-12', attrs: { position: 'open', sizeIn: '3' } } },
    { op: 'addLink', link: { from: 'pump:HWP-1', to: 'valve:V-12', type: 'flowsTo', system: 'hhw', attrs: { sizeIn: 3, material: 'Steel' } } },
  ], 'acc-1', NOW);
  const pump = graph.nodes.find((n) => n.id === 'pump:HWP-1');
  assert.deepEqual(pump.attrs.flowGpm, { value: 120, provenance: 'as-entered', source: 'Entered in Precedent', enteredBy: 'acc-1', enteredAt: NOW });
  assert.equal(pump.system, 'hhw');
  const link = graph.links.find((l) => l.from === 'pump:HWP-1');
  assert.equal(link.provenance, 'as-entered');
  assert.equal(link.attrs.sizeIn.value, 3);
  assert.equal(graph.rev, 1);
  assert.deepEqual(touched.sort(), ['pump:HWP-1', 'valve:V-12']);
  // Undo restores the original exactly.
  const undone = applyOps(graph, inverse, 'acc-1', NOW).graph;
  assert.deepEqual(undone.nodes, seed.nodes);
  assert.deepEqual(undone.links, seed.links);
});

test('remove a node takes its links; undo puts both back', () => {
  const { graph, inverse } = applyOps(seed, [{ op: 'removeNode', id: 'breaker:RTU-1' }], 'a', NOW);
  assert.ok(!graph.links.some((l) => l.from === 'breaker:RTU-1' || l.to === 'breaker:RTU-1'));
  const back = applyOps(graph, inverse, 'a', NOW).graph;
  assert.equal(back.links.length, seed.links.length);
  assert.ok(back.nodes.some((n) => n.id === 'breaker:RTU-1'));
});

test('update keeps other values and their provenance; unset and undo', () => {
  const { graph, inverse } = applyOps(seed, [{ op: 'updateNode', id: 'breaker:RTU-2', set: { ratingA: 300 }, unset: ['ratingAssumed'], pos: { x: 1, y: 2, z: 3 } }], 'a', NOW);
  const b = graph.nodes.find((n) => n.id === 'breaker:RTU-2');
  assert.equal(b.attrs.ratingA.provenance, 'as-entered');
  assert.equal(b.attrs.poles.provenance, 'illustrative');
  assert.deepEqual(b.pos, { x: 1, y: 2, z: 3 });
  const back = applyOps(graph, inverse, 'a', NOW).graph;
  assert.deepEqual(back.nodes.find((n) => n.id === 'breaker:RTU-2'), seed.nodes.find((n) => n.id === 'breaker:RTU-2'));
});

test('batches are all or nothing, with a clear error', () => {
  assert.throws(() => applyOps(seed, [
    { op: 'addNode', node: { type: 'Valve', name: 'V-1' } },
    { op: 'addLink', link: { from: 'valve:V-1', to: 'nope:X', type: 'flowsTo' } },
  ], 'a', NOW), /Edit 2 of 2: nope:X isn't in this graph/);
  assert.throws(() => applyOps(seed, [{ op: 'addLink', link: { from: 'breaker:RTU-1', to: 'feeder:RTU-1', type: 'feeds' } }], 'a', NOW), /already feeds/);
  assert.throws(() => applyOps(seed, [{ op: 'addLink', link: { from: 'breaker:RTU-1', to: 'breaker:RTU-1', type: 'feeds' } }], 'a', NOW), /itself/);
  assert.throws(() => applyOps(seed, [{ op: 'addNode', node: { type: 'valve', name: 'x' } }], 'a', NOW), /isn't valid/);
  assert.throws(() => applyOps(seed, [{ op: 'addNode', node: { type: 'Valve', name: ' ' } }], 'a', NOW), /needs a name/);
  assert.throws(() => applyOps(seed, [{ op: 'drop' }], 'a', NOW), /Unknown edit/);
});

test('ids are unique and readable', () => {
  const nodes = new Map([['valve:V-1', {}], ['valve:V-1-2', {}]]);
  assert.equal(newNodeId(nodes, 'Valve', 'V-1'), 'valve:V-1-3');
  assert.equal(newNodeId(nodes, 'Equipment', 'ahu 3'), 'equipment:AHU-3');
  assert.equal(newNodeId(nodes, 'Pump', 'Pump #2 (CHW)'), 'pump:Pump-2-CHW');
});

test('a new site graph starts from its equipment register', () => {
  const g = newGraph({ building: 'Plant 2', equipment: [{ tag: 'AHU-1', category: 'Air handler', objectKey: 'PREC-9' }, { tag: 'B-1', category: 'Boiler' }] }, 'a', NOW);
  assert.equal(g.nodes.length, 2);
  assert.equal(g.nodes[0].id, 'equipment:AHU-1');
  assert.equal(g.nodes[0].attrs.category.source, 'Equipment register (Jira Assets PREC-9)');
  assert.ok(!('manufacturer' in g.nodes[0].attrs), 'empty values are not stored');
  assert.equal(newGraph({}, 'a', NOW).nodes.length, 0);
});
