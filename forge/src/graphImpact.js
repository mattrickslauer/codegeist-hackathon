/**
 * "What if?" over the building graph: tracing, failure impact and isolation plans.
 * Pure (no Forge imports); tested in test/graphImpact.test.mjs. docs/ARCHITECTURE.md §6.8.
 *
 * Flow follows directed links (feeds, flowsTo, serves) plus support (a unit loses its support when its curb goes).
 * Sources are components nothing flows into. A component is supplied when some path from a source reaches it
 * without passing a failed component or a device that is currently stopping flow (closed valve, open breaker).
 *
 * These are checks to help plan work. They are not a lockout/tagout procedure or engineering sign-off.
 */
import { LINK_TYPES, blocksFlow, isIsolationDevice, systemOfLink } from './graphSchema.js';

const FLOW_TYPES = new Set(Object.entries(LINK_TYPES).filter(([, t]) => t.directed).map(([k]) => k));

/** Directed flow adjacency. `supportedBy` (unit → curb) is reversed: the curb "supplies" the unit's support. */
export function flowIndex(graph) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const down = new Map();
  const up = new Map();
  const add = (a, b, link) => {
    if (!nodes.has(a) || !nodes.has(b)) return;
    if (!down.has(a)) down.set(a, []);
    if (!up.has(b)) up.set(b, []);
    down.get(a).push({ id: b, link });
    up.get(b).push({ id: a, link });
  };
  for (const l of graph.links) {
    if (FLOW_TYPES.has(l.type)) add(l.from, l.to, l);
    else if (l.type === 'supportedBy') add(l.to, l.from, l);
  }
  return { nodes, down, up };
}

/**
 * The kind of supply a link carries. A component needs every kind it receives: a rooftop unit needs power
 * *and* its curb; a coil fed chilled and hot water loses heating if the hot water goes.
 */
function supplyKind(link, nodes) {
  if (link.type === 'feeds') return 'power';
  if (link.type === 'supportedBy') return 'support';
  if (link.type === 'serves') return 'serves';
  return `flow:${systemOfLink(link, nodes)}`;
}

/**
 * Ids that have supply: least fixpoint, so a loop cut off from every source is correctly unsupplied.
 * A component is supplied when it isn't blocked and, for each kind it receives, at least one upstream
 * component of that kind is supplied. Components that receive nothing are sources (supplied unless blocked).
 */
function supplied(fx, blocked) {
  const needs = new Map(); // id → Map(kind → [upstream ids])
  for (const [id, ups] of fx.up) {
    const byKind = new Map();
    for (const { id: from, link } of ups) {
      const k = supplyKind(link, fx.nodes);
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k).push(from);
    }
    needs.set(id, byKind);
  }
  const alive = new Set();
  const queue = [];
  for (const id of fx.nodes.keys()) if (!needs.has(id) && !blocked.has(id)) { alive.add(id); queue.push(id); }
  const ready = (id) => [...needs.get(id).values()].every((ups) => ups.some((u) => alive.has(u)));
  while (queue.length) {
    const id = queue.shift();
    for (const { id: next } of fx.down.get(id) ?? []) {
      if (alive.has(next) || blocked.has(next) || !ready(next)) continue;
      alive.add(next);
      queue.push(next);
    }
  }
  return alive;
}

/** Devices in the graph that are stopping flow right now. */
const currentlyBlocking = (fx) => new Set([...fx.nodes.values()].filter(blocksFlow).map((n) => n.id));

/** Everything upstream and downstream of a component, with the links on the way (for highlighting a path). */
export function trace(graph, id) {
  const fx = flowIndex(graph);
  if (!fx.nodes.has(id)) throw new Error(`${id} isn't in this graph`);
  const walk = (start, dir) => {
    const ids = new Set();
    const links = [];
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const { id: next, link } of fx[dir].get(cur) ?? []) {
        links.push(link);
        if (ids.has(next) || next === start) continue;
        ids.add(next);
        queue.push(next);
      }
    }
    return { ids: [...ids], links };
  };
  const upstream = walk(id, 'up');
  const downstream = walk(id, 'down');
  return { upstream: upstream.ids, downstream: downstream.ids, links: [...upstream.links, ...downstream.links] };
}

/**
 * What loses supply if `failedIds` fail (or are isolated)? Respects redundancy: a component fed two ways keeps
 * its supply while one way remains. Returns { lost: [{ id, depth }], lostByType, sources } where depth is the
 * number of hops from the nearest failed component (for the animated wave). Components already without supply
 * (behind a valve that is closed today) are not counted as lost.
 */
export function impact(graph, failedIds) {
  const fx = flowIndex(graph);
  const failed = new Set(failedIds.filter((id) => fx.nodes.has(id)));
  const blockedNow = currentlyBlocking(fx);
  const before = supplied(fx, blockedNow);
  const after = supplied(fx, new Set([...blockedNow, ...failed]));

  // Failed components that had supply count as lost themselves (depth 0); a source that fails also counts.
  const lostSet = new Set([...before].filter((id) => !after.has(id)));
  for (const id of failed) if (!blockedNow.has(id)) lostSet.add(id);

  // Depth: BFS downstream from the failed components, through lost components only.
  const depth = new Map([...failed].filter((id) => lostSet.has(id)).map((id) => [id, 0]));
  const queue = [...depth.keys()];
  while (queue.length) {
    const id = queue.shift();
    for (const { id: next } of fx.down.get(id) ?? []) {
      if (!lostSet.has(next) || depth.has(next)) continue;
      depth.set(next, depth.get(id) + 1);
      queue.push(next);
    }
  }
  const lost = [...lostSet].map((id) => ({ id, depth: depth.get(id) ?? 1 })).sort((a, b) => a.depth - b.depth);
  const lostByType = {};
  for (const { id } of lost) {
    const t = fx.nodes.get(id).type;
    lostByType[t] = (lostByType[t] ?? 0) + 1;
  }
  return { failed: [...failed], lost, lostByType };
}

/**
 * How to isolate a component for work: walk upstream from it; on each path the first isolation device
 * (valve, breaker, disconnect, damper, transfer switch) is a point to close/open. Paths that reach a source with
 * no device on the way are reported as `unisolated` (the planner must find another way, e.g. a shutdown upstream).
 * Downstream devices are listed too (backfeed / back-flow from the other side), and the side effects: what else
 * loses supply when those points are operated.
 */
export function isolationPlan(graph, id) {
  const fx = flowIndex(graph);
  const target = fx.nodes.get(id);
  if (!target) throw new Error(`${id} isn't in this graph`);

  /**
   * Walk from the target to the first isolation device on every path. Upstream follows every supply link.
   * Downstream follows pipes and ducts only (back-flow; electrical loads don't backfeed in this model), and stops
   * at a merge point fed from elsewhere: a valve beyond it would cut other users off, so that path is unisolated.
   */
  const firstDevices = (dir) => {
    const points = new Set();
    const unisolated = [];
    const seen = new Set([id]);
    const queue = [{ id, path: [] }];
    while (queue.length) {
      const cur = queue.shift();
      const nexts = (fx[dir].get(cur.id) ?? []).filter((e) => e.link.type === 'flowsTo' || (dir === 'up' && e.link.type === 'feeds'));
      if (!nexts.length && cur.id !== id && dir === 'up') unisolated.push(cur.path);
      for (const { id: next } of nexts) {
        if (seen.has(next)) continue;
        seen.add(next);
        const node = fx.nodes.get(next);
        const path = [...cur.path, next];
        if (isIsolationDevice(node)) {
          points.add(next);
          continue;
        }
        if (dir === 'down' && (fx.up.get(next) ?? []).length > 1) {
          unisolated.push(path);
          continue;
        }
        queue.push({ id: next, path });
      }
    }
    return { points: [...points], unisolated };
  };

  const upstream = firstDevices('up');
  const downstream = firstDevices('down');
  const downPoints = downstream.points;

  const points = [...upstream.points, ...downPoints];
  const effect = impact(graph, points);
  // Losing the target's own downstream is expected; side effects are what else goes down with the points.
  const expected = new Set([id, ...points, ...impact(graph, [id]).lost.map((l) => l.id)]);
  const sideEffects = effect.lost.filter((l) => !expected.has(l.id));

  return {
    target: id,
    operate: points.map((p) => {
      const n = fx.nodes.get(p);
      const valveLike = n.type === 'Valve' || n.type === 'Damper';
      return { id: p, action: valveLike ? 'close' : 'open (off)', side: upstream.points.includes(p) ? 'upstream' : 'downstream' };
    }),
    unisolatedPaths: upstream.unisolated.map((path) => path.map((p) => fx.nodes.get(p).name)),
    // Pipes leaving the target that join flow from elsewhere with no valve first (back-flow risk).
    unisolatedDownstream: downstream.unisolated.map((path) => path.map((p) => fx.nodes.get(p).name)),
    sideEffects,
  };
}
