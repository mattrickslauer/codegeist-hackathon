/**
 * What needs attention at a site, for the Building view (pure; unit-tested in test/graphAttention.test.mjs).
 *
 * Inputs are the site graph, its decisions and its open work orders (each with its normalised `walkdown.check`).
 * Output drives the "Needs attention" list and the status colours in the 3D scene.
 */

export const NEAR_CAPACITY = 0.8;

const num = (fact) => (typeof fact?.value === 'number' ? fact.value : Number(fact?.value) || 0);

/** Every panel's connected breaker load against its bus rating, with the equipment it feeds. */
export function panelLoads(graph) {
  const nodes = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const feeds = new Map();
  for (const l of graph?.links ?? []) {
    if (l.type !== 'feeds') continue;
    if (!feeds.has(l.from)) feeds.set(l.from, []);
    feeds.get(l.from).push(l.to);
  }
  /** Equipment reached by following `feeds` from a node (breaker → feeder → disconnect → unit). */
  const equipmentBelow = (id, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const n = nodes.get(id);
    if (n?.type === 'Equipment') return [n.name];
    return (feeds.get(id) ?? []).flatMap((next) => equipmentBelow(next, seen));
  };
  const out = [];
  for (const panel of nodes.values()) {
    if (panel.type !== 'Panel') continue;
    const busA = num(panel.attrs?.busA);
    const breakers = (feeds.get(panel.id) ?? []).map((id) => nodes.get(id)).filter((n) => n?.type === 'Breaker');
    const connectedA = breakers.reduce((sum, b) => sum + num(b.attrs?.ratingA), 0);
    const equipment = [...new Set(breakers.flatMap((b) => equipmentBelow(b.id)))];
    out.push({
      id: panel.id,
      name: panel.name,
      busA,
      connectedA,
      ratio: busA ? connectedA / busA : 0,
      equipment,
      provenance: panel.attrs?.busA?.provenance ?? null,
    });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

/**
 * The site's attention list, most urgent first, plus a status per graph node for the scene:
 * 'blocked' (a blocked work order touches it) > 'approval' (a proposed decision is about it) >
 * 'capacity' (a panel at ≥ 80 % of its bus) > 'decision' (a standing decision governs it).
 */
export function siteAttention({ graph, decisions = [], orders = [] }) {
  const items = [];
  const byTag = new Map();
  const mark = (tag, status) => {
    const rank = { blocked: 4, approval: 3, capacity: 2, decision: 1 };
    if ((rank[status] ?? 0) > (rank[byTag.get(tag)] ?? 0)) byTag.set(tag, status);
  };

  for (const o of orders ?? []) {
    if (o?.check?.status !== 'conflict') continue;
    const conflict = o.check.conflicts?.[0] ?? null;
    const tags = [...new Set((o.check.conflicts ?? []).flatMap((c) => c.matched ?? []))];
    tags.forEach((t) => mark(t, 'blocked'));
    items.push({ kind: 'blocked', id: `wo:${o.key}`, key: o.key, title: o.summary, tags, detail: conflict?.statement ?? o.check.summary ?? null });
  }
  for (const d of decisions ?? []) {
    if (d?.status !== 'proposed') continue;
    (d.equipment ?? []).forEach((t) => mark(t, 'approval'));
    items.push({ kind: 'approval', id: `dec:${d.id}`, decisionId: d.id, title: d.statement, tags: d.equipment ?? [], detail: d.reason ?? null });
  }
  const panels = panelLoads(graph);
  const capacityNodes = new Set();
  for (const p of panels) {
    if (p.ratio < NEAR_CAPACITY) continue;
    capacityNodes.add(p.id);
    items.push({
      kind: 'capacity',
      id: `panel:${p.id}`,
      nodeId: p.id,
      title: `${p.name} at ${Math.round(p.ratio * 100)}%`,
      tags: p.equipment,
      detail: `${p.connectedA.toLocaleString()} A of breakers on a ${p.busA.toLocaleString()} A bus`,
      provenance: p.provenance,
    });
  }
  for (const d of decisions ?? []) {
    if (d?.status === 'standing') (d.equipment ?? []).forEach((t) => mark(t, 'decision'));
  }

  // Status per graph node id: equipment by tag, panels by id.
  const nodeStatus = new Map();
  for (const n of graph?.nodes ?? []) {
    if (n.type === 'Equipment' && byTag.has(n.name)) nodeStatus.set(n.id, byTag.get(n.name));
    if (capacityNodes.has(n.id)) nodeStatus.set(n.id, 'capacity');
  }
  return { items, tagStatus: byTag, nodeStatus, panels };
}
