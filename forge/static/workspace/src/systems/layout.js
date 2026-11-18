/**
 * Pure layout helpers for the systems workspace (tested in test/layout.test.mjs).
 *  - schematicLayout: a layered left-to-right drawing (sources on the left, loads and served areas on the right).
 *  - scenePositions: 3D anchor for every component: its own placement, its equipment's position in the model,
 *    or (for things nobody has placed yet) a floating position above what it supplies, stacked by depth.
 */
import { LINK_TYPES, systemOfLink, systemOfNode } from '../../../../src/graphSchema.js';

const DIRECTED = new Set(Object.entries(LINK_TYPES).filter(([, t]) => t.directed).map(([k]) => k));

/** Visible components and connections for a set of system filters (null = everything). */
export function visibleSubgraph(graph, systems) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const links = graph.links.filter((l) => l.type !== 'locatedOn' && l.type !== 'protects' && (!systems || systems.has(systemOfLink(l, nodes))));
  const keep = new Set();
  for (const l of links) { keep.add(l.from); keep.add(l.to); }
  for (const n of graph.nodes) {
    const s = systemOfNode(n);
    if (!keep.has(n.id) && (!systems || (s && systems.has(s)) || (!s && systems.has('other')))) keep.add(n.id);
  }
  // Levels are filing, not equipment: only show them when they are connected to something drawn.
  const shown = graph.nodes.filter((n) => keep.has(n.id) && (n.type !== 'Level' || links.some((l) => l.from === n.id || l.to === n.id)));
  const ids = new Set(shown.map((n) => n.id));
  return { nodes: shown, links: links.filter((l) => ids.has(l.from) && ids.has(l.to)) };
}

/**
 * Layered layout. Layer = longest directed path from a source (cycles broken by visit order).
 * Order within a layer: barycentre sweeps to cut crossings. Returns { pos: Map(id → {x, y}), width, height }.
 */
export function schematicLayout(nodes, links, { colGap = 210, rowGap = 56, pad = 60 } = {}) {
  const ids = nodes.map((n) => n.id);
  const outs = new Map(ids.map((id) => [id, []]));
  const ins = new Map(ids.map((id) => [id, []]));
  const nbrs = new Map(ids.map((id) => [id, new Set()]));
  for (const l of links) {
    if (!outs.has(l.from) || !outs.has(l.to)) continue;
    nbrs.get(l.from).add(l.to);
    nbrs.get(l.to).add(l.from);
    if (DIRECTED.has(l.type)) { outs.get(l.from).push(l.to); ins.get(l.to).push(l.from); }
    else if (l.type === 'supportedBy') { outs.get(l.to).push(l.from); ins.get(l.from).push(l.to); }
  }

  // Longest path layering with DFS cycle-breaking.
  const layer = new Map();
  const state = new Map();
  const visit = (id) => {
    if (layer.has(id)) return layer.get(id);
    if (state.get(id) === 'active') return 0; // back edge
    state.set(id, 'active');
    let l = 0;
    for (const p of ins.get(id)) l = Math.max(l, visit(p) + 1);
    state.set(id, 'done');
    layer.set(id, l);
    return l;
  };
  ids.forEach(visit);

  // Undirected-only components sit next to what they connect to.
  for (const id of ids) {
    if (ins.get(id).length || outs.get(id).length) continue;
    const ls = [...nbrs.get(id)].map((n) => layer.get(n)).filter((x) => x !== undefined);
    if (ls.length) layer.set(id, Math.max(...ls) + 1);
  }

  const maxLayer = Math.max(0, ...layer.values());
  const cols = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) cols[layer.get(n.id)].push(n.id);
  cols.forEach((c) => c.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));

  const order = new Map();
  const reindex = () => cols.forEach((c) => c.forEach((id, i) => order.set(id, i)));
  reindex();
  const bary = (id) => {
    const ns = [...nbrs.get(id)];
    return ns.length ? ns.reduce((s, n) => s + (order.get(n) ?? 0), 0) / ns.length : order.get(id);
  };
  for (let sweep = 0; sweep < 14; sweep += 1) {
    const range = sweep % 2 ? [...cols.keys()].reverse() : [...cols.keys()];
    for (const c of range) {
      const b = new Map(cols[c].map((id) => [id, bary(id)]));
      cols[c].sort((x, y) => b.get(x) - b.get(y));
      cols[c].forEach((id, i) => order.set(id, i));
    }
  }

  const tallest = Math.max(1, ...cols.map((c) => c.length));
  const pos = new Map();
  cols.forEach((c, ci) => {
    const offset = ((tallest - c.length) * rowGap) / 2; // centre short columns
    c.forEach((id, i) => pos.set(id, { x: pad + ci * colGap, y: pad + offset + i * rowGap }));
  });
  return { pos, width: pad * 2 + maxLayer * colGap + 160, height: pad * 2 + (tallest - 1) * rowGap + 40, layer };
}

/**
 * 3D anchors. `tagCentres`: Map(tag → {x,y,z}) from the model (equipment meshes); `bounds`: model box
 * { min: {x,y,z}, max: {x,y,z} } or null. Returns Map(id → { x, y, z, placed: 'set'|'model'|'floating' }).
 */
export function scenePositions(graph, tagCentres, bounds) {
  const out = new Map();
  for (const n of graph.nodes) {
    if (n.pos) out.set(n.id, { ...n.pos, placed: 'set' });
    else if (n.type === 'Equipment' && tagCentres?.has(n.name)) out.set(n.id, { ...tagCentres.get(n.name), placed: 'model' });
  }
  const nbrs = new Map(graph.nodes.map((n) => [n.id, []]));
  const downs = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const l of graph.links) {
    if (!nbrs.has(l.from) || !nbrs.has(l.to) || l.type === 'locatedOn') continue;
    nbrs.get(l.from).push(l.to);
    nbrs.get(l.to).push(l.from);
    if (DIRECTED.has(l.type)) downs.get(l.from).push(l.to);
  }

  // Floating height: hops from the anchored world (things further upstream float higher).
  const hop = new Map([...out.keys()].map((id) => [id, 0]));
  let frontier = [...out.keys()];
  while (frontier.length) {
    const next = [];
    for (const id of frontier) for (const n of nbrs.get(id)) if (!hop.has(n)) { hop.set(n, hop.get(id) + 1); next.push(n); }
    frontier = next;
  }

  const size = bounds ? Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 1) : 40;
  const top = bounds ? bounds.max.y : 0;
  const centre = bounds ? { x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2 } : { x: 0, z: 0 };
  const lift = size * 0.035;

  // xz: mean of anchored neighbours, relaxed a few times so chains spread toward what they feed.
  const floating = graph.nodes.filter((n) => !out.has(n.id));
  const xz = new Map();
  for (let pass = 0; pass < 8; pass += 1) {
    for (const n of floating) {
      const ref = (downs.get(n.id).length ? downs.get(n.id) : nbrs.get(n.id))
        .map((m) => out.get(m) ?? xz.get(m)).filter(Boolean);
      if (ref.length) xz.set(n.id, { x: ref.reduce((s, p) => s + p.x, 0) / ref.length, z: ref.reduce((s, p) => s + p.z, 0) / ref.length });
    }
  }

  // Spread nodes that land on the same spot, and park unconnected ones on a shelf beside the model.
  const taken = new Map();
  let shelf = 0;
  for (const n of floating) {
    let p = xz.get(n.id);
    let y;
    if (!p) {
      const row = Math.floor(shelf / 8);
      p = { x: centre.x - size * 0.6 - row * size * 0.06, z: centre.z - size * 0.35 + (shelf % 8) * size * 0.1 };
      y = top;
      shelf += 1;
    } else {
      y = top + lift * Math.max(1, hop.get(n.id) ?? 1);
    }
    const key = `${Math.round(p.x * 4)}|${Math.round(y * 4)}|${Math.round(p.z * 4)}`;
    const k = taken.get(key) ?? 0;
    taken.set(key, k + 1);
    const angle = k * 2.399; // golden angle spiral
    const r = k ? size * 0.018 * Math.sqrt(k) : 0;
    out.set(n.id, { x: p.x + Math.cos(angle) * r, y, z: p.z + Math.sin(angle) * r, placed: 'floating' });
  }
  return out;
}
