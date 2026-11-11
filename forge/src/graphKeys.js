/** Pure helpers for graph storage and site selection (no Forge imports; tested in test/graphStore.test.mjs). */

/** KVS key holding a site's whole building graph. */
export const graphKey = (siteId) => `graph:${siteId}`;

/**
 * Which site an agent question is about.
 * `sites`: sites that have a graph. `projectKey`: the Jira space the agent was opened from, if any.
 * Returns the site, null when no site has a graph (caller falls back to the bundled sample), or throws when
 * several sites could match and nothing says which.
 */
export function siteForAction(sites, projectKey) {
  if (projectKey) {
    const linked = sites.find((s) => s.space?.key === projectKey);
    if (linked) return linked;
  }
  if (sites.length === 0) return null;
  if (sites.length === 1) return sites[0];
  throw new Error(`Which site? Precedent has several: ${sites.map((s) => s.name).join(', ')}. Ask from a work order in the site's Jira space, or name the site.`);
}

/** A node in the compact, model-friendly form actions return: every fact keeps its provenance and source. */
export const factsOf = (node) => (node ? { id: node.id, type: node.type, name: node.name, facts: node.attrs } : null);
