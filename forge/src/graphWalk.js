/**
 * Pure building-graph queries (no Forge imports; tested in test/graphWalk.test.mjs).
 * Graph shape: docs/ARCHITECTURE.md §5.2 ("Building context graph seed").
 */
import { normaliseTagInput } from './tags.js';

/** Maps for fast lookups: nodes by id, links by (from|to, type). */
export function indexGraph(graph) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map();
  const into = new Map();
  for (const l of graph.links) {
    const o = `${l.from}|${l.type}`;
    const i = `${l.to}|${l.type}`;
    if (!out.has(o)) out.set(o, []);
    if (!into.has(i)) into.set(i, []);
    out.get(o).push(l);
    into.get(i).push(l);
  }
  return { nodes, out, into };
}

const outgoing = (ix, id, type) => (ix.out.get(`${id}|${type}`) ?? []).map((l) => ix.nodes.get(l.to));
const incoming = (ix, id, type) => (ix.into.get(`${id}|${type}`) ?? []).map((l) => ix.nodes.get(l.from));
const value = (node, attr) => node?.attrs?.[attr]?.value;

/** The equipment node for a loosely typed tag ("rtu 2" → equipment:RTU-2), or a clear error. */
export function findEquipment(ix, tag) {
  const t = normaliseTagInput(tag);
  const node = t && ix.nodes.get(`equipment:${t}`);
  if (!node) {
    // Name the tags that do exist, so an agent can offer real alternatives instead of guessing.
    const all = [...ix.nodes.values()].filter((n) => n.type === 'Equipment').map((n) => n.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const prefix = t.split('-')[0];
    const similar = all.filter((name) => prefix && name.split('-')[0] === prefix);
    const hint = similar.length ? `Similar tags here: ${similar.join(', ')}.` : `Equipment tags here: ${all.join(', ')}.`;
    throw new Error(`Equipment ${t || String(tag ?? '')} isn't in this site's graph. ${hint}`);
  }
  return node;
}

/** Nodes from the power source down to the equipment (empty when nothing feeds it). */
export function powerChain(ix, tag) {
  const eq = findEquipment(ix, tag);
  const chain = [eq];
  const seen = new Set([eq.id]);
  for (;;) {
    const [up] = incoming(ix, chain[0].id, 'feeds');
    if (!up || seen.has(up.id)) break;
    seen.add(up.id);
    chain.unshift(up);
  }
  return chain.length > 1 ? chain : [];
}

/** Follow `supportedBy` to the end: curb, then roof zone. */
function supportPath(ix, id) {
  const path = [];
  let [next] = outgoing(ix, id, 'supportedBy');
  while (next && !path.includes(next)) {
    path.push(next);
    [next] = outgoing(ix, next.id, 'supportedBy');
  }
  return path;
}

/** Everything a contractor needs about one piece of equipment, straight from the graph. */
export function context(ix, tag) {
  const equipment = findEquipment(ix, tag);
  const chain = powerChain(ix, tag);
  const serves = outgoing(ix, equipment.id, 'serves');
  const connects = outgoing(ix, equipment.id, 'connects');
  const loopMembers = connects
    .filter((n) => n.type === 'PipeLoop')
    .flatMap((loop) => incoming(ix, loop.id, 'connects'))
    .filter((n) => n.id !== equipment.id);
  const support = supportPath(ix, equipment.id);

  let panel = null;
  const panelNode = chain.find((n) => n.type === 'Panel');
  if (panelNode) {
    const breakers = outgoing(ix, panelNode.id, 'feeds').filter((n) => n.type === 'Breaker');
    panel = {
      id: panelNode.id,
      name: panelNode.name,
      busA: value(panelNode, 'busA'),
      connectedBreakerA: breakers.reduce((sum, b) => sum + (value(b, 'ratingA') ?? 0), 0),
      siblings: breakers
        .map((b) => outgoing(ix, b.id, 'feeds')[0])
        .map((f) => f && outgoing(ix, f.id, 'feeds')[0])
        .map((d) => d && outgoing(ix, d.id, 'feeds')[0])
        .filter((e) => e && e.id !== equipment.id)
        .map((e) => e.name),
      provenance: panelNode.attrs.busA?.provenance ?? null,
    };
  }

  const involved = [equipment, ...chain, ...serves, ...connects, ...support];
  const provenanceSummary = { asBuilt: 0, illustrative: 0, asInstalled: 0 };
  const seen = new Set();
  for (const n of involved) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    for (const a of Object.values(n.attrs)) {
      if (a.provenance === 'as-built') provenanceSummary.asBuilt += 1;
      else if (a.provenance === 'illustrative') provenanceSummary.illustrative += 1;
      else if (a.provenance === 'as-installed') provenanceSummary.asInstalled += 1;
    }
  }

  return { equipment, powerChain: chain, serves, connects, loopMembers, support, panel, provenanceSummary };
}
