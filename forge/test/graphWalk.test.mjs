import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { context, findEquipment, indexGraph, powerChain } from '../src/graphWalk.js';

const graph = JSON.parse(readFileSync(new URL('../src/seed/exb-graph.json', import.meta.url), 'utf8'));
const ix = indexGraph(graph);

test('normalises tag', () => {
  assert.equal(findEquipment(ix, ' rtu 2 ').id, 'equipment:RTU-2');
  assert.equal(findEquipment(ix, 'hwb1').id, 'equipment:HWB-1');
});

test('unknown tag', () => {
  assert.throws(() => findEquipment(ix, 'XYZ-9'), /isn't in this site's graph/);
  assert.throws(() => findEquipment(ix, ''), /isn't in this site's graph/);
});

test('unknown tag lists the similar tags that do exist', () => {
  assert.throws(() => findEquipment(ix, 'RTU-12'), /Equipment RTU-12 isn't in this site's graph\. Similar tags here: RTU-1, RTU-2, RTU-3, RTU-4\./);
  assert.throws(() => findEquipment(ix, 'ZZ-1'), /Equipment tags here: .*RTU-4/);
});

test('RTU-1 power chain, source first', () => {
  const ids = powerChain(ix, 'RTU-1').map((n) => n.id);
  assert.deepEqual(ids, ['switchboard:MSB', 'panel:RDP-N', 'breaker:RTU-1', 'feeder:RTU-1', 'disconnect:RTU-1', 'equipment:RTU-1']);
});

test('elevator has empty chain', () => {
  assert.deepEqual(powerChain(ix, 'ELEV-1'), []);
});

test('context RTU-1', () => {
  const c = context(ix, 'RTU-1');
  assert.equal(c.equipment.id, 'equipment:RTU-1');
  assert.deepEqual(c.serves.map((n) => n.name), ['North tower, levels 2-5']);
  assert.deepEqual(c.support.map((n) => n.id), ['curb:RTU-1', 'roofzone:RZ-N']);
  assert.equal(c.powerChain.length, 6);
  assert.ok(c.provenanceSummary.asBuilt > 0);
  assert.ok(c.provenanceSummary.illustrative > 0);
  assert.equal(c.provenanceSummary.asInstalled, 0);
});

test('context of a boiler includes the heating loop and its other members', () => {
  const c = context(ix, 'HWB-1');
  assert.deepEqual(c.connects.map((n) => n.id), ['pipeloop:HHW']);
  assert.deepEqual(c.loopMembers.map((n) => n.id).sort(), ['equipment:HWB-2', 'equipment:HWP-1', 'equipment:HWP-2']);
});

test('panel siblings: what else hangs off the same panel', () => {
  const c = context(ix, 'RTU-2');
  assert.equal(c.panel.id, 'panel:RDP-N');
  assert.equal(c.panel.connectedBreakerA, 1005);
  assert.equal(c.panel.busA, 1200);
  assert.ok(c.panel.siblings.includes('RTU-1'));
  assert.ok(!c.panel.siblings.includes('RTU-2'));
});
