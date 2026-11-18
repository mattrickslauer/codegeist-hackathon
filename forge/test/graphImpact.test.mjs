import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOps } from '../src/graphEdit.js';
import { impact, isolationPlan, trace } from '../src/graphImpact.js';

const seed = JSON.parse(readFileSync(new URL('../src/seed/exb-graph.json', import.meta.url), 'utf8'));

/** A small chilled-water plant: two pumps in parallel (redundant), valves, a coil. */
function plant(extra = []) {
  return applyOps({ nodes: [], links: [] }, [
    { op: 'addNode', node: { type: 'Equipment', name: 'CH-1' } },
    { op: 'addNode', node: { type: 'Valve', name: 'V-1', attrs: { position: 'open' } } },
    { op: 'addNode', node: { type: 'Valve', name: 'V-2', attrs: { position: 'open' } } },
    { op: 'addNode', node: { type: 'Pump', name: 'P-1' } },
    { op: 'addNode', node: { type: 'Pump', name: 'P-2' } },
    { op: 'addNode', node: { type: 'Junction', name: 'J-1' } },
    { op: 'addNode', node: { type: 'Valve', name: 'V-3', attrs: { position: 'open' } } },
    { op: 'addNode', node: { type: 'Equipment', name: 'AHU-1' } },
    { op: 'addNode', node: { type: 'ServedArea', name: 'Level 2 offices' } },
    ...[['equipment:CH-1', 'valve:V-1'], ['equipment:CH-1', 'valve:V-2'], ['valve:V-1', 'pump:P-1'], ['valve:V-2', 'pump:P-2'],
      ['pump:P-1', 'junction:J-1'], ['pump:P-2', 'junction:J-1'], ['junction:J-1', 'valve:V-3'], ['valve:V-3', 'equipment:AHU-1']]
      .map(([from, to]) => ({ op: 'addLink', link: { from, to, type: 'flowsTo', system: 'chw' } })),
    { op: 'addLink', link: { from: 'equipment:AHU-1', to: 'servedarea:Level-2-offices', type: 'serves' } },
    ...extra,
  ], 'a').graph;
}

test('one pump of a redundant pair fails: nothing downstream is lost', () => {
  const r = impact(plant(), ['pump:P-1']);
  assert.deepEqual(r.lost.map((l) => l.id), ['pump:P-1']);
});

test('both pumps fail: the junction, valve, coil and served area go down, in wave order', () => {
  const r = impact(plant(), ['pump:P-1', 'pump:P-2']);
  assert.deepEqual(r.lost.map((l) => [l.id, l.depth]), [
    ['pump:P-1', 0], ['pump:P-2', 0], ['junction:J-1', 1], ['valve:V-3', 2], ['equipment:AHU-1', 3], ['servedarea:Level-2-offices', 4],
  ]);
  assert.equal(r.lostByType.ServedArea, 1);
});

test('a valve closed today counts: with V-2 shut, losing P-1 takes out the coil', () => {
  const g = plant([{ op: 'updateNode', id: 'valve:V-2', set: { position: 'closed' } }]);
  const lost = impact(g, ['pump:P-1']).lost.map((l) => l.id);
  assert.ok(lost.includes('equipment:AHU-1'));
  assert.ok(!lost.includes('pump:P-2'), 'already without supply, not newly lost');
});

test('sample building: losing panel RDP-N takes its breakers and the units it feeds, nothing on RDP-S', () => {
  const lost = new Set(impact(seed, ['panel:RDP-N']).lost.map((l) => l.id));
  assert.ok(lost.has('equipment:RTU-1'));
  assert.ok(lost.has('breaker:RTU-1'));
  assert.ok(!lost.has('equipment:CU-1'), 'CU-1 is on RDP-S');
  assert.ok([...lost].some((id) => id.startsWith('servedarea:')), 'served areas go dark too');
});

test('trace finds upstream and downstream', () => {
  const t = trace(seed, 'breaker:RTU-1');
  assert.ok(t.upstream.includes('switchboard:MSB'));
  assert.ok(t.downstream.includes('equipment:RTU-1'));
  assert.ok(t.links.length >= 4);
});

test('isolation plan for the coil: close V-3; no side effects beyond the coil’s own loads', () => {
  const p = isolationPlan(plant(), 'equipment:AHU-1');
  assert.deepEqual(p.operate, [{ id: 'valve:V-3', action: 'close', side: 'upstream' }]);
  assert.deepEqual(p.unisolatedPaths, []);
  assert.deepEqual(p.sideEffects, []);
});

test('isolation plan for pump P-1: close V-1 upstream; no downstream valve before the junction', () => {
  const p = isolationPlan(plant(), 'pump:P-1');
  assert.deepEqual(p.operate.map((o) => o.id), ['valve:V-1']);
  assert.deepEqual(p.unisolatedDownstream, [['J-1']], 'back-flow from P-2 through the junction is called out');
});

test('sample building: RTU-1 still loses power when panel RDP-N fails, even though its curb stands', () => {
  const lost = impact(seed, ['panel:RDP-N']).lost.map((l) => l.id);
  assert.ok(lost.includes('equipment:RTU-1'));
  assert.ok(lost.includes('servedarea:north-tower-levels-2-5'));
  assert.ok(!lost.includes('curb:RTU-1'));
});

test('a loop cut off from its source is unsupplied (least fixpoint)', () => {
  const g = applyOps({ nodes: [], links: [] }, [
    { op: 'addNode', node: { type: 'Equipment', name: 'B-1' } },
    { op: 'addNode', node: { type: 'Junction', name: 'J-A' } },
    { op: 'addNode', node: { type: 'Junction', name: 'J-B' } },
    { op: 'addLink', link: { from: 'equipment:B-1', to: 'junction:J-A', type: 'flowsTo' } },
    { op: 'addLink', link: { from: 'junction:J-A', to: 'junction:J-B', type: 'flowsTo' } },
    { op: 'addLink', link: { from: 'junction:J-B', to: 'junction:J-A', type: 'flowsTo' } },
  ], 'a').graph;
  assert.deepEqual(impact(g, ['equipment:B-1']).lost.map((l) => l.id), ['equipment:B-1', 'junction:J-A', 'junction:J-B']);
});

test('sample building: isolating RTU-1 means opening its disconnect', () => {
  const p = isolationPlan(seed, 'equipment:RTU-1');
  assert.deepEqual(p.operate, [{ id: 'disconnect:RTU-1', action: 'open (off)', side: 'upstream' }]);
});

test('nothing to close upstream is reported, not hidden', () => {
  const g = applyOps({ nodes: [], links: [] }, [
    { op: 'addNode', node: { type: 'Equipment', name: 'TK-1' } },
    { op: 'addNode', node: { type: 'Pump', name: 'P-9' } },
    { op: 'addLink', link: { from: 'equipment:TK-1', to: 'pump:P-9', type: 'flowsTo' } },
  ], 'a').graph;
  const p = isolationPlan(g, 'pump:P-9');
  assert.deepEqual(p.operate, []);
  assert.deepEqual(p.unisolatedPaths, [['TK-1']]);
});
