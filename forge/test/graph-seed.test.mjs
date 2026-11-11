/**
 * Invariants of the generated building graph (forge/src/seed/exb-graph.json, built by scripts/build_exb_graph.py).
 * Design: docs/ARCHITECTURE.md §6.7 G1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const graph = JSON.parse(readFileSync(new URL('../src/seed/exb-graph.json', import.meta.url), 'utf8'));
const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
const PROVENANCE = ['as-built', 'illustrative', 'as-installed'];
const val = (id, attr) => nodes.get(id)?.attrs?.[attr]?.value;
const linksFrom = (id, type) => graph.links.filter((l) => l.from === id && l.type === type).map((l) => l.to);
const linksTo = (id, type) => graph.links.filter((l) => l.to === id && l.type === type).map((l) => l.from);

/** Follow incoming `feeds` links from the equipment back to the source. */
function chain(tag) {
  const out = [`equipment:${tag}`];
  for (;;) {
    const up = linksTo(out[0], 'feeds');
    if (!up.length) return out;
    out.unshift(up[0]);
  }
}

test('every node, attribute and link has provenance and source', () => {
  for (const n of graph.nodes) {
    assert.ok(n.id && n.type && n.name, `node fields ${n.id}`);
    for (const [k, a] of Object.entries(n.attrs)) {
      assert.ok(PROVENANCE.includes(a.provenance), `${n.id}.${k} provenance ${a.provenance}`);
      assert.ok(a.source, `${n.id}.${k} source`);
    }
  }
  for (const l of graph.links) {
    assert.ok(PROVENANCE.includes(l.provenance), `link ${l.from}→${l.to} provenance`);
    assert.ok(l.source, `link ${l.from}→${l.to} source`);
  }
});

test('no dangling links and unique node ids', () => {
  assert.equal(nodes.size, graph.nodes.length);
  for (const l of graph.links) {
    assert.ok(nodes.has(l.from), `missing ${l.from}`);
    assert.ok(nodes.has(l.to), `missing ${l.to}`);
  }
});

test('RTU-1 chain: switchboard → panel → 600 A breaker → 2 × 350 kcmil Cu → disconnect → RTU-1', () => {
  const c = chain('RTU-1');
  assert.equal(c.length, 6);
  assert.equal(c[0], 'switchboard:MSB');
  assert.match(c[1], /^panel:/);
  assert.deepEqual(c.slice(2), ['breaker:RTU-1', 'feeder:RTU-1', 'disconnect:RTU-1', 'equipment:RTU-1']);
  assert.equal(val('breaker:RTU-1', 'ratingA'), 600);
  assert.equal(val('feeder:RTU-1', 'sets'), 2);
  assert.equal(val('feeder:RTU-1', 'size'), '350 kcmil');
  assert.equal(val('feeder:RTU-1', 'material'), 'Cu');
  assert.deepEqual(linksFrom('breaker:RTU-1', 'protects'), ['feeder:RTU-1']);
});

test('RTU-2 chain: 250 A breaker, 1 × 250 kcmil', () => {
  assert.equal(chain('RTU-2').length, 6);
  assert.equal(val('breaker:RTU-2', 'ratingA'), 250);
  assert.equal(val('feeder:RTU-2', 'sets'), 1);
  assert.equal(val('feeder:RTU-2', 'size'), '250 kcmil');
});

test('boilers: 15 A breaker, 12 AWG', () => {
  for (const tag of ['HWB-1', 'HWB-2']) {
    assert.equal(val(`breaker:${tag}`, 'ratingA'), 15);
    assert.equal(val(`feeder:${tag}`, 'size'), '12 AWG');
  }
});

test('real ratings stay as-built with their sheet', () => {
  assert.deepEqual(nodes.get('equipment:RTU-1').attrs.mopA, { value: 600, provenance: 'as-built', source: 'E3.06A; mech schedule p10' });
  assert.equal(nodes.get('equipment:RTU-1').attrs.weightLb.value, 90000);
  assert.equal(nodes.get('equipment:HWB-1').attrs.flaA.value, 6.5);
});

test('assumed ratings are flagged', () => {
  for (const n of graph.nodes.filter((x) => x.type === 'Breaker' && /:(CU|EF|HWP)-/.test(x.id))) {
    assert.equal(n.attrs.ratingAssumed?.value, true, `${n.id} ratingAssumed`);
    assert.equal(n.attrs.ratingA.provenance, 'illustrative');
  }
});

test('one tight panel, and RTU-2 is on it', () => {
  const panels = graph.nodes.filter((n) => n.type === 'Panel');
  const tight = panels.filter((p) => {
    const total = linksFrom(p.id, 'feeds').reduce((sum, b) => sum + val(b, 'ratingA'), 0);
    return total >= 0.8 * val(p.id, 'busA');
  });
  assert.equal(tight.length, 1);
  assert.equal(chain('RTU-2')[1], tight[0].id);
});

test('structure: RTU → curb → roof zone, with load limits', () => {
  for (const tag of ['RTU-1', 'RTU-2', 'RTU-3', 'RTU-4']) {
    const [curb] = linksFrom(`equipment:${tag}`, 'supportedBy');
    assert.equal(curb, `curb:${tag}`);
    const [zone] = linksFrom(curb, 'supportedBy');
    assert.match(zone, /^roofzone:/);
    assert.ok(val(curb, 'loadLimitLb') >= val(`equipment:${tag}`, 'weightLb'), `${tag} fits its curb`);
  }
  assert.ok(val('curb:RTU-2', 'loadLimitLb') < 1.2 * 27000, 'RTU-2 curb has < 20% headroom');
});

test('served areas, heating loop, line sets, elevators', () => {
  const served = linksFrom('equipment:RTU-1', 'serves').map((id) => nodes.get(id).name);
  assert.deepEqual(served, ['North tower, levels 2-5']);
  for (const tag of ['HWB-1', 'HWB-2', 'HWP-1', 'HWP-2']) assert.deepEqual(linksFrom(`equipment:${tag}`, 'connects'), ['pipeloop:HHW']);
  assert.deepEqual(linksFrom('equipment:CU-3', 'connects'), ['lineset:CU-3']);
  assert.deepEqual(chain('ELEV-1'), ['equipment:ELEV-1']);
  assert.deepEqual(linksFrom('equipment:RTU-1', 'locatedOn'), ['level:ROOF']);
});
