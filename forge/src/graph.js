/**
 * Per-site building context graph (docs/ARCHITECTURE.md §6.7). App storage (KVS) is the source of truth;
 * the Assets mirror comes later. Pure queries live in graphWalk.js, pure helpers in graphKeys.js.
 */
import { kvs } from '@forge/kvs';
import bundled from './seed/exb-graph.json';
import { context, indexGraph } from './graphWalk';
import { factsOf, graphKey, graphLogKey, isSampleBuilding, siteForAction } from './graphKeys';
import { applyOps, newGraph } from './graphEdit';
import { listSiteEquipment } from './assets';
import { listDecisions } from './decisions';
import { getSite, listSites } from './sites';

/** Copy the bundled sample graph into a site (the sample building). */
export async function seedGraph(siteId) {
  const graph = { ...bundled, seededFrom: 'exb-graph.json', updatedAt: new Date().toISOString() };
  await kvs.set(graphKey(siteId), graph);
  return { nodes: graph.nodes.length, links: graph.links.length };
}

export const getGraph = (siteId) => kvs.get(graphKey(siteId));

/**
 * The site's graph. Sample-building sites created before the graph existed (≤ v6.10) are seeded on first read,
 * from any path (site page, agent, MCP), so every reader sees the same data.
 */
async function ensureGraph(site) {
  const graph = await getGraph(site.id);
  if (graph || !isSampleBuilding(site)) return graph ?? null;
  await seedGraph(site.id);
  return getGraph(site.id);
}
export async function deleteGraph(siteId) {
  await kvs.delete(graphKey(siteId));
  await kvs.delete(graphLogKey(siteId));
}

// ---------- Editing (§6.8): read, start, edit, undo, history ----------

/** Recent edits, newest first. Each keeps its inverse so it can be undone; capped by count and size. */
const LOG_MAX = 40;
const LOG_BYTES = 180_000;

async function appendLog(siteId, entry) {
  const log = (await kvs.get(graphLogKey(siteId))) ?? [];
  log.unshift(entry);
  while (log.length > LOG_MAX || (log.length > 1 && JSON.stringify(log).length > LOG_BYTES)) log.pop();
  if (JSON.stringify(log).length > LOG_BYTES) log[0] = { ...log[0], inverse: null }; // a single huge edit: kept, not undoable
  await kvs.set(graphLogKey(siteId), log);
}

/** The site's graph for the editor (seeding the sample building on first read), or null with what could start it. */
export async function getSiteGraph(siteId) {
  const site = await getSite(siteId);
  const graph = await ensureGraph(site);
  if (graph) return { graph: { ...graph, rev: graph.rev ?? 0 } };
  return { graph: null, canStartFromRegister: site.equipmentSource?.kind === 'assets' };
}

/** Start a graph for a site that has none: from its equipment register when it has one, else empty. */
export async function startSiteGraph(siteId, accountId) {
  const site = await getSite(siteId);
  const existing = await ensureGraph(site);
  if (existing) return { graph: existing };
  let equipment = [];
  if (site.equipmentSource?.kind === 'assets') {
    try { equipment = (await listSiteEquipment(site.equipmentSource.siteName)).equipment ?? []; } catch (err) { console.warn(`register for ${siteId}: ${err.message}`); }
  }
  const graph = newGraph({ building: site.name, equipment }, accountId);
  await kvs.set(graphKey(siteId), graph);
  return { graph };
}

/**
 * Apply edits. `rev` is the revision the editor last saw: if someone else saved in between, the edit is refused
 * so nobody silently overwrites a colleague (the editor reloads and the person tries again).
 */
export async function editSiteGraph({ siteId, rev, ops, label } = {}, accountId) {
  const site = await getSite(siteId);
  const current = await ensureGraph(site);
  if (!current) throw new Error('This site has no connections yet. Start them first.');
  if (Number.isInteger(rev) && rev !== (current.rev ?? 0)) throw new Error('Someone else just changed this site’s connections. Reload to see their changes, then try again.');
  const now = new Date().toISOString();
  const { graph, inverse, touched } = applyOps(current, ops, accountId, now);
  await kvs.set(graphKey(siteId), graph);
  await appendLog(siteId, { rev: graph.rev, at: now, by: accountId ?? null, label: String(label ?? '').slice(0, 140) || describeOps(ops, current), count: ops.length, inverse });
  return { graph, touched };
}

/** Undo the most recent undoable edit (any user's; the log shows who did what). */
export async function undoSiteGraph({ siteId, rev } = {}, accountId) {
  const log = (await kvs.get(graphLogKey(siteId))) ?? [];
  const i = log.findIndex((e) => e.inverse && !e.undone);
  if (i < 0) throw new Error('Nothing to undo');
  const entry = log[i];
  const result = await editSiteGraph({ siteId, rev, ops: entry.inverse, label: `Undo: ${entry.label}` }, accountId);
  const fresh = (await kvs.get(graphLogKey(siteId))) ?? [];
  const target = fresh.find((e) => e.rev === entry.rev && e.at === entry.at);
  const undoEntry = fresh[0];
  if (target) target.undone = true;
  if (undoEntry) undoEntry.inverse = null; // undoing an undo is "redo" by hand for now
  await kvs.set(graphLogKey(siteId), fresh);
  return result;
}

export async function graphHistory(siteId) {
  const log = (await kvs.get(graphLogKey(siteId))) ?? [];
  return log.map(({ inverse, ...e }) => ({ ...e, undoable: Boolean(inverse) && !e.undone }));
}

/** "Added V-12 · Connected V-12 → AHU-1" for the history list. */
function describeOps(ops, graph) {
  const name = (id) => graph.nodes.find((n) => n.id === id)?.name ?? ops.find((o) => o.node?.id === id)?.node?.name ?? id.split(':')[1];
  const parts = ops.slice(0, 3).map((o) => {
    switch (o.op) {
      case 'addNode': return `Added ${o.node?.name}`;
      case 'updateNode': return `Edited ${name(o.id)}`;
      case 'removeNode': return `Removed ${name(o.id)}`;
      case 'addLink': return `Connected ${name(o.link?.from)} → ${name(o.link?.to)}`;
      case 'updateLink': return `Edited ${name(o.key?.from)} → ${name(o.key?.to)}`;
      case 'removeLink': return `Disconnected ${name(o.key?.from)} → ${name(o.key?.to)}`;
      default: return o.op;
    }
  });
  return parts.join(' · ') + (ops.length > 3 ? ` · +${ops.length - 3} more` : '');
}

/** Standing decisions about one tag, in the short form the brief needs. */
async function standingDecisions(siteId, tag) {
  if (!siteId) return [];
  return (await listDecisions(siteId))
    .filter((d) => d.status === 'standing' && d.equipment.includes(tag))
    .map((d) => ({ statement: d.statement, reason: d.reason, guardedActions: d.guards, decidedAt: d.decidedAt }));
}

/** For the site page: the equipment's context from this site's graph, or { source: 'none' }. */
export async function equipmentContextForSite(siteId, tag) {
  const graph = await ensureGraph(await getSite(siteId));
  if (!graph) return { source: 'none' };
  return { source: 'graph', context: context(indexGraph(graph), tag) };
}

/**
 * For the Rovo action / MCP tool: resolve the site, then return the equipment's context as compact facts.
 * Inputs may be hallucinated; they only select data, never grant access.
 */
export async function equipmentContextForAction(payload) {
  const graphs = new Map();
  for (const s of await listSites()) {
    const g = await ensureGraph(s);
    if (g) graphs.set(s.id, { site: s, graph: g });
  }
  const site = siteForAction([...graphs.values()].map((x) => x.site), payload?.context?.jira?.projectKey, payload?.site);
  const graph = site ? graphs.get(site.id).graph : bundled;
  const c = context(indexGraph(graph), payload?.tag);
  const tag = c.equipment.name;
  return {
    site: site ? `${site.name}${site.space?.key ? ` (Jira space ${site.space.key})` : ''}` : `${bundled.building} (bundled sample; not loaded as a site yet)`,
    note: 'Each fact has a provenance: as-built (from the record drawings; source = sheet), illustrative (sample data written for the demo, NOT the real building), as-installed (from a completed job), or as-entered (typed in by the site team in Precedent; enteredBy/enteredAt say who and when).',
    equipment: factsOf(c.equipment),
    powerChainFromSource: c.powerChain.map(factsOf),
    panel: c.panel,
    serves: c.serves.map((n) => n.name),
    connectedTo: c.connects.map(factsOf),
    sharesLoopWith: c.loopMembers.map((n) => n.name),
    supportedBy: c.support.map(factsOf),
    standingDecisions: await standingDecisions(site?.id, tag),
    provenanceSummary: c.provenanceSummary,
  };
}
