/**
 * Per-site building context graph (docs/ARCHITECTURE.md §6.7). App storage (KVS) is the source of truth;
 * the Assets mirror comes later. Pure queries live in graphWalk.js, pure helpers in graphKeys.js.
 */
import { kvs } from '@forge/kvs';
import bundled from './seed/exb-graph.json';
import { context, indexGraph } from './graphWalk';
import { factsOf, graphKey, siteForAction } from './graphKeys';
import { listDecisions } from './decisions';
import { getSite, listSites } from './sites';

/** Copy the bundled sample graph into a site (the sample building). */
export async function seedGraph(siteId) {
  const graph = { ...bundled, seededFrom: 'exb-graph.json', updatedAt: new Date().toISOString() };
  await kvs.set(graphKey(siteId), graph);
  return { nodes: graph.nodes.length, links: graph.links.length };
}

export const getGraph = (siteId) => kvs.get(graphKey(siteId));
export const deleteGraph = (siteId) => kvs.delete(graphKey(siteId));

/** Standing decisions about one tag, in the short form the brief needs. */
async function standingDecisions(siteId, tag) {
  if (!siteId) return [];
  return (await listDecisions(siteId))
    .filter((d) => d.status === 'standing' && d.equipment.includes(tag))
    .map((d) => ({ statement: d.statement, reason: d.reason, guardedActions: d.guards, decidedAt: d.decidedAt }));
}

/** For the site page: the equipment's context from this site's graph, or { source: 'none' }. */
export async function equipmentContextForSite(siteId, tag) {
  let graph = await getGraph(siteId);
  if (!graph && (await getSite(siteId)).model?.path === 'models/exb.glb') {
    // Sample-building sites created before the graph existed (≤ v6.10): seed on first read.
    await seedGraph(siteId);
    graph = await getGraph(siteId);
  }
  if (!graph) return { source: 'none' };
  return { source: 'graph', context: context(indexGraph(graph), tag) };
}

/**
 * For the Rovo action / MCP tool: resolve the site, then return the equipment's context as compact facts.
 * Inputs may be hallucinated; they only select data, never grant access.
 */
export async function equipmentContextForAction(payload) {
  const sites = await listSites();
  const withGraph = [];
  for (const s of sites) if (await getGraph(s.id)) withGraph.push(s);
  const site = siteForAction(withGraph, payload?.context?.jira?.projectKey);
  const graph = site ? await getGraph(site.id) : bundled;
  const c = context(indexGraph(graph), payload?.tag);
  const tag = c.equipment.name;
  return {
    site: site ? site.name : `${bundled.building} (bundled sample; not loaded as a site yet)`,
    note: 'Each fact has a provenance: as-built (from the record drawings; source = sheet), illustrative (sample data written for the demo, NOT the real building), or as-installed (from a completed job).',
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
