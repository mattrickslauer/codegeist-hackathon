/**
 * Editing the building graph: a small set of operations, each validated and each returning its inverse (undo).
 * Pure (no Forge imports); tested in test/graphEdit.test.mjs. docs/ARCHITECTURE.md §6.8.
 *
 * Values typed by a person get provenance `as-entered`, with who and when, so entered data is never confused
 * with as-built (drawings), illustrative (demo) or as-installed (accepted closeout) data.
 *
 * Ops:
 *   { op: 'addNode', node: { id?, type, name, attrs?: { k: value }, pos?, system? } }
 *   { op: 'updateNode', id, name?, set?: { k: value }, unset?: [k], pos?: {x,y,z}|null, system?: key|null }
 *   { op: 'removeNode', id }                       (removes its links too)
 *   { op: 'addLink', link: { from, to, type, system?, attrs? } }
 *   { op: 'updateLink', key: { from, to, type }, set?, unset?, system? }
 *   { op: 'removeLink', key: { from, to, type } }
 * Internal (used by inverses): 'putNode' (restore a whole node), 'putLink' (restore a whole link).
 */

export const LIMITS = { nodes: 3000, links: 6000, name: 120, value: 1000, attrs: 60, bytes: 230_000 };

const ID_RE = /^[a-z][a-z0-9]*:[A-Za-z0-9._\-]+$/;
const TYPE_RE = /^[A-Z][A-Za-z0-9]{0,40}$/;
const LINK_TYPE_RE = /^[a-z][A-Za-z]{0,30}$/;
const ATTR_RE = /^[a-zA-Z][A-Za-z0-9_]{0,40}$/;
const SYSTEM_RE = /^[a-z][a-z0-9_-]{0,30}$/;

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const linkId = (l) => `${l.from}|${l.type}|${l.to}`;

/** "Pump P-1 (CHW)" → "P-1-CHW"-ish slug for ids. */
export function slug(s) {
  return String(s ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

function cleanValue(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Numbers must be finite');
    return v;
  }
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim();
  if (s.length > LIMITS.value) throw new Error(`Values are limited to ${LIMITS.value} characters`);
  // Typed numbers stay numbers ("250" → 250) so they can be summed and compared.
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
}

function entered(value, actor, now, note) {
  return { value: cleanValue(value), provenance: 'as-entered', source: note || 'Entered in Precedent', enteredBy: actor ?? null, enteredAt: now };
}

function cleanPos(pos) {
  if (pos === null) return null;
  const p = { x: Number(pos?.x), y: Number(pos?.y), z: Number(pos?.z) };
  if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error('Position needs numeric x, y and z');
  return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) };
}

function checkName(name) {
  const s = String(name ?? '').trim();
  if (!s) throw new Error('Every component needs a name or tag');
  if (s.length > LIMITS.name) throw new Error(`Names are limited to ${LIMITS.name} characters`);
  return s;
}

function checkSystem(system) {
  if (system === null || system === undefined || system === '') return null;
  if (!SYSTEM_RE.test(system)) throw new Error(`Unknown system "${system}"`);
  return system;
}

function setAttrs(target, set, actor, now, note) {
  for (const [k, v] of Object.entries(set ?? {})) {
    if (!ATTR_RE.test(k)) throw new Error(`Attribute names are letters and digits ("${k}")`);
    if (v === null || v === undefined || v === '') delete target[k];
    else target[k] = entered(v, actor, now, note);
  }
  if (Object.keys(target).length > LIMITS.attrs) throw new Error(`At most ${LIMITS.attrs} values per item`);
}

/** Index a graph for editing: node map and link map (by from|type|to). Mutates in place via the returned helpers. */
function workingCopy(graph) {
  const g = clone(graph ?? { nodes: [], links: [] });
  g.nodes ??= [];
  g.links ??= [];
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const links = new Map(g.links.map((l) => [linkId(l), l]));
  return { g, nodes, links };
}

/** Next free id for a new node: "<type>:<slug(name)>", suffixed -2, -3… if taken. */
export function newNodeId(nodes, type, name) {
  const prefix = type === 'Equipment' ? 'equipment' : type.toLowerCase();
  const base = `${prefix}:${type === 'Equipment' ? slug(name).toUpperCase() : slug(name)}`;
  if (!nodes.has(base)) return base;
  for (let i = 2; ; i += 1) if (!nodes.has(`${base}-${i}`)) return `${base}-${i}`;
}

function applyOne(w, op, actor, now) {
  const { nodes, links } = w;
  const note = op.note ? String(op.note).slice(0, 300) : undefined;
  switch (op?.op) {
    case 'addNode': {
      const n = op.node ?? {};
      if (!TYPE_RE.test(n.type ?? '')) throw new Error(`Component type "${n.type}" isn't valid`);
      const name = checkName(n.name);
      const id = n.id ?? newNodeId(nodes, n.type, name);
      if (!ID_RE.test(id)) throw new Error(`Invalid id "${id}"`);
      if (nodes.has(id)) throw new Error(`${id} already exists`);
      if (nodes.size >= LIMITS.nodes) throw new Error(`A site graph holds at most ${LIMITS.nodes} components`);
      const node = { id, type: n.type, name, attrs: {} };
      setAttrs(node.attrs, n.attrs, actor, now, note);
      if (n.pos) node.pos = cleanPos(n.pos);
      const system = checkSystem(n.system);
      if (system) node.system = system;
      node.createdBy = actor ?? null;
      node.createdAt = now;
      nodes.set(id, node);
      return { inverse: [{ op: 'removeNode', id }], touched: [id] };
    }
    case 'updateNode': {
      const node = nodes.get(op.id);
      if (!node) throw new Error(`${op.id} isn't in this graph`);
      const before = clone(node);
      if (op.name !== undefined) node.name = checkName(op.name);
      setAttrs(node.attrs, op.set, actor, now, note);
      for (const k of op.unset ?? []) delete node.attrs[k];
      if (op.pos !== undefined) {
        const p = cleanPos(op.pos);
        if (p) node.pos = p;
        else delete node.pos;
      }
      if (op.system !== undefined) {
        const s = checkSystem(op.system);
        if (s) node.system = s;
        else delete node.system;
      }
      node.updatedBy = actor ?? null;
      node.updatedAt = now;
      return { inverse: [{ op: 'putNode', node: before }], touched: [op.id] };
    }
    case 'removeNode': {
      const node = nodes.get(op.id);
      if (!node) throw new Error(`${op.id} isn't in this graph`);
      const removedLinks = [...links.values()].filter((l) => l.from === op.id || l.to === op.id);
      for (const l of removedLinks) links.delete(linkId(l));
      nodes.delete(op.id);
      return { inverse: [{ op: 'putNode', node: clone(node) }, ...removedLinks.map((l) => ({ op: 'putLink', link: clone(l) }))], touched: [op.id] };
    }
    case 'addLink': {
      const l = op.link ?? {};
      if (!nodes.has(l.from)) throw new Error(`${l.from} isn't in this graph`);
      if (!nodes.has(l.to)) throw new Error(`${l.to} isn't in this graph`);
      if (l.from === l.to) throw new Error('A component can’t connect to itself');
      if (!LINK_TYPE_RE.test(l.type ?? '')) throw new Error(`Connection type "${l.type}" isn't valid`);
      const link = { from: l.from, to: l.to, type: l.type, provenance: 'as-entered', source: note || 'Entered in Precedent', enteredBy: actor ?? null, enteredAt: now };
      if (links.has(linkId(link))) throw new Error(`${nodes.get(l.from).name} already ${l.type} ${nodes.get(l.to).name}`);
      if (links.size >= LIMITS.links) throw new Error(`A site graph holds at most ${LIMITS.links} connections`);
      const system = checkSystem(l.system);
      if (system) link.system = system;
      if (l.attrs && Object.keys(l.attrs).length) {
        link.attrs = {};
        setAttrs(link.attrs, l.attrs, actor, now, note);
      }
      links.set(linkId(link), link);
      return { inverse: [{ op: 'removeLink', key: { from: link.from, to: link.to, type: link.type } }], touched: [link.from, link.to] };
    }
    case 'updateLink': {
      const link = links.get(linkId(op.key ?? {}));
      if (!link) throw new Error('That connection isn’t in this graph');
      const before = clone(link);
      if (op.set || op.unset) {
        link.attrs ??= {};
        setAttrs(link.attrs, op.set, actor, now, note);
        for (const k of op.unset ?? []) delete link.attrs[k];
        if (!Object.keys(link.attrs).length) delete link.attrs;
      }
      if (op.system !== undefined) {
        const s = checkSystem(op.system);
        if (s) link.system = s;
        else delete link.system;
      }
      return { inverse: [{ op: 'putLink', link: before, replace: true }], touched: [link.from, link.to] };
    }
    case 'removeLink': {
      const id = linkId(op.key ?? {});
      const link = links.get(id);
      if (!link) throw new Error('That connection isn’t in this graph');
      links.delete(id);
      return { inverse: [{ op: 'putLink', link: clone(link) }], touched: [link.from, link.to] };
    }
    case 'putNode': {
      const node = clone(op.node);
      if (!node?.id || !ID_RE.test(node.id)) throw new Error('Invalid node');
      const before = nodes.get(node.id);
      nodes.set(node.id, node);
      return { inverse: [before ? { op: 'putNode', node: clone(before) } : { op: 'removeNode', id: node.id }], touched: [node.id] };
    }
    case 'putLink': {
      const link = clone(op.link);
      if (!nodes.has(link?.from) || !nodes.has(link?.to)) throw new Error('Can’t restore a connection whose components are gone');
      const before = links.get(linkId(link));
      links.set(linkId(link), link);
      return {
        inverse: [before ? { op: 'putLink', link: clone(before), replace: true } : { op: 'removeLink', key: { from: link.from, to: link.to, type: link.type } }],
        touched: [link.from, link.to],
      };
    }
    default:
      throw new Error(`Unknown edit "${op?.op}"`);
  }
}

/**
 * Apply ops in order, all or nothing. Returns { graph, inverse, touched }: `inverse` undoes the whole batch
 * (apply it with applyOps to undo); `touched` lists affected node ids.
 */
export function applyOps(graph, ops, actor, now = new Date().toISOString()) {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('No edits');
  if (ops.length > 500) throw new Error('At most 500 edits at once');
  const w = workingCopy(graph);
  const inverse = [];
  const touched = new Set();
  ops.forEach((op, i) => {
    try {
      const r = applyOne(w, op, actor, now);
      inverse.unshift(...r.inverse);
      r.touched.forEach((t) => touched.add(t));
    } catch (err) {
      throw new Error(ops.length > 1 ? `Edit ${i + 1} of ${ops.length}: ${err.message}` : err.message);
    }
  });
  const out = { ...w.g, nodes: [...w.nodes.values()], links: [...w.links.values()] };
  out.rev = (graph?.rev ?? 0) + 1;
  out.updatedAt = now;
  const bytes = JSON.stringify(out).length;
  if (bytes > LIMITS.bytes) throw new Error(`This graph would be ${Math.round(bytes / 1000)} KB; the limit is ${LIMITS.bytes / 1000} KB per site for now`);
  return { graph: out, inverse, touched: [...touched] };
}

/** A new, empty graph for a site, optionally pre-filled with its equipment register (tag, category, level…). */
export function newGraph({ building, equipment = [] } = {}, actor, now = new Date().toISOString()) {
  const base = { schemaVersion: 2, building: building ?? '', about: 'Built in Precedent by the site team.', nodes: [], links: [], rev: 0 };
  if (!equipment.length) return { ...base, updatedAt: now };
  const ops = equipment.slice(0, LIMITS.nodes).map((e) => ({
    op: 'addNode',
    note: e.objectKey ? `Equipment register (Jira Assets ${e.objectKey})` : 'Equipment register',
    node: {
      type: 'Equipment',
      name: e.tag,
      attrs: { category: e.category ?? e.type ?? '', manufacturer: e.manufacturer ?? '', level: e.level ?? '', serves: e.serves ?? '' },
    },
  }));
  const { graph } = applyOps(base, ops, actor, now);
  return { ...graph, rev: 1 };
}
