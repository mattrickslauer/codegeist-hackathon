import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../src/graphEdit.js';
import { guessType, importOps, parseTable } from '../src/graphImport.js';

const base = applyOps({ nodes: [], links: [] }, [{ op: 'addNode', node: { type: 'Equipment', name: 'AHU-1' } }], 'a').graph;

test('parses tab and comma tables with quotes', () => {
  assert.deepEqual(parseTable('a\tb\n1\t2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseTable('a,b\n"x, y","say ""hi"""'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('guesses types from tags', () => {
  assert.equal(guessType('V-12'), 'Valve');
  assert.equal(guessType('BFV-3'), 'Valve');
  assert.equal(guessType('CHWP-2'), 'Pump');
  assert.equal(guessType('PNL-H1'), 'Panel');
  assert.equal(guessType('MSB'), 'Switchboard');
  assert.equal(guessType('RTU-4'), 'Equipment');
  assert.equal(guessType('CV-1'), 'CheckValve');
});

test('connections table creates missing components and pipes with sizes; existing names are reused', () => {
  const text = 'From\tTo\tSystem\tSize\tMaterial\nCHWP-1\tV-12\tChilled water\t4"\tSteel\nV-12\tahu-1\tCHW\t4\tSteel\nV-12\tAHU-1\tCHW\t4\tSteel';
  const r = importOps(base, text);
  assert.deepEqual(r.summary, { components: 2, connections: 2, updated: 0 });
  assert.equal(r.warnings.length, 1, 'duplicate row warned');
  const { graph } = applyOps(base, r.ops, 'a');
  const link = graph.links.find((l) => l.to === 'equipment:AHU-1');
  assert.equal(link.type, 'flowsTo');
  assert.equal(link.system, 'chw');
  assert.equal(link.attrs.sizeIn.value, 4);
  assert.equal(graph.nodes.find((n) => n.name === 'CHWP-1').type, 'Pump');
});

test('electrical rows become feeds', () => {
  const r = importOps(base, 'From,To,System\nMSB,PNL-H1,Electrical\nPNL-H1,AHU-1,power');
  const { graph } = applyOps(base, r.ops, 'a');
  assert.deepEqual(graph.links.map((l) => l.type), ['feeds', 'feeds']);
});

test('components table sets values and updates existing ones', () => {
  const r = importOps(base, 'Tag,Type,Size (in),Position,Rating A\nV-1,Valve,2,closed,\nAHU-1,,,,\nCB-4,,,,20');
  assert.deepEqual(r.summary, { components: 2, connections: 0, updated: 0 });
  const { graph } = applyOps(base, r.ops, 'a');
  const v = graph.nodes.find((n) => n.name === 'V-1');
  assert.equal(v.attrs.sizeIn.value, 2);
  assert.equal(v.attrs.position.value, 'closed');
  assert.equal(graph.nodes.find((n) => n.name === 'CB-4').type, 'Breaker');
});

test('unusable paste explains itself', () => {
  assert.match(importOps(base, 'hello').warnings[0], /header row/);
  assert.match(importOps(base, 'colour,shape\nred,round').warnings[0], /From and To/);
});

test('rows match existing components by the tag in their id', () => {
  const g = applyOps(base, [{ op: 'addNode', node: { id: 'switchboard:MSB', type: 'Switchboard', name: 'Main switchboard MSB' } }], 'a').graph;
  const r = importOps(g, 'From,To,System\nMSB,PNL-H1,Electrical');
  assert.equal(r.summary.components, 1, 'only PNL-H1 is new');
  assert.equal(r.ops.find((o) => o.op === 'addLink').link.from, 'switchboard:MSB');
});
