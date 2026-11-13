/**
 * Data access for the workspace.
 * - Precedent's own records (sites) go through our resolver (`invoke`).
 * - Jira data (spaces, work orders) is read as the current user with `requestJira`,
 *   so people only ever see spaces and work orders they're allowed to see in Jira.
 */
import { invoke, objectStore, requestJira, router } from '@forge/bridge';
import { normaliseCheck } from './siteState.js';

export const CHECK_PROPERTY = 'precedent.check';

// ---------- Precedent (resolver) ----------
export const api = {
  ping: () => invoke('ping'),
  listSites: () => invoke('listSites'),
  getSite: (id) => invoke('getSite', { id }),
  createSite: (input) => invoke('createSite', input),
  updateSite: (input) => invoke('updateSite', input),
  deleteSite: (id) => invoke('deleteSite', { id }),
  addScanToSite: (input) => invoke('addScanToSite', input),
  loadSampleSite: (space) => invoke('loadSampleSite', { space }),
  loadSampleBuilding: (space) => invoke('loadSampleBuilding', { space }),
  getSiteEquipment: (siteId) => invoke('getSiteEquipment', { siteId }),
  getEquipmentContext: (siteId, tag) => invoke('getEquipmentContext', { siteId, tag }),
  // Systems editor
  getSiteGraph: (siteId) => invoke('getSiteGraph', { siteId }),
  startSiteGraph: (siteId) => invoke('startSiteGraph', { siteId }),
  editSiteGraph: (siteId, rev, ops, label) => invoke('editSiteGraph', { siteId, rev, ops, label }),
  undoSiteGraph: (siteId, rev) => invoke('undoSiteGraph', { siteId, rev }),
  graphHistory: (siteId) => invoke('graphHistory', { siteId }),
  // Decisions
  listDecisions: (siteId) => invoke('listDecisions', { siteId }),
  createDecision: (input) => invoke('createDecision', input),
  withdrawDecision: (siteId, decisionId) => invoke('withdrawDecision', { siteId, decisionId }),
  proposeSupersession: (input) => invoke('proposeSupersession', input),
  approveDecision: (siteId, decisionId) => invoke('approveDecision', { siteId, decisionId }),
  // Work orders
  checkWorkOrder: (issueKey) => invoke('checkWorkOrder', { issueKey }),
  reaffirmConflict: (input) => invoke('reaffirmConflict', input),
  setWorkOrderEquipment: (issueKey, tags) => invoke('setWorkOrderEquipment', { issueKey, tags }),
};

/** Upload a scan file to Object Store and attach it to a site. Returns the updated site. */
export async function uploadScanToSite(siteId, file) {
  const [up] = await objectStore.upload({ functionKey: 'getScanUploadUrls', objects: [file] });
  if (!up?.success) throw new Error(`Upload failed (${up?.status ?? 'no status'}) ${up?.error ?? ''}`.trim());
  return api.addScanToSite({ siteId, key: up.key, fileName: file.name });
}

/** Download a stored scan as a Blob (for the 3D viewer). */
export async function downloadScan(key) {
  const [down] = await objectStore.download({ functionKey: 'getScanDownloadUrls', keys: [key] });
  if (!down?.success || !down.blob) throw new Error(`Download failed (${down?.status ?? 'no status'}) ${down?.error ?? ''}`.trim());
  return down.blob;
}

// ---------- Jira (as the user) ----------
async function jiraJson(path, options) {
  const res = await requestJira(path, options);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Jira ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/** Jira spaces (projects) the user can see, for linking a site. */
export async function listSpaces() {
  const data = await jiraJson('/rest/api/3/project/search?maxResults=100&orderBy=name');
  return data.values.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    projectTypeKey: p.projectTypeKey,
    avatarUrl: p.avatarUrls?.['24x24'] ?? null,
  }));
}

const jqlString = (value) => `"${String(value).replace(/["\\]/g, '\\$&')}"`;

/** Recent work orders in a space, with Precedent's check result for each. */
export async function listWorkOrders(spaceKey, max = 25) {
  const data = await jiraJson('/rest/api/3/search/jql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: `project = ${jqlString(spaceKey)} AND statusCategory != Done ORDER BY updated DESC`,
      maxResults: max,
      fields: ['summary', 'status', 'issuetype', 'assignee', 'updated'],
      properties: [CHECK_PROPERTY],
    }),
  });
  return data.issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status?.name,
    statusCategory: i.fields.status?.statusCategory?.key,
    issueType: i.fields.issuetype?.name,
    assignee: i.fields.assignee?.displayName ?? null,
    updated: i.fields.updated,
    check: normaliseCheck(i.properties?.[CHECK_PROPERTY]),
  }));
}

export const openWorkOrdersJql = (spaceKey) => `project = ${jqlString(spaceKey)} AND statusCategory != Done`;
export const blockedWorkOrdersJql = (spaceKey) => `project = ${jqlString(spaceKey)} AND precedentStatus = conflict`;

/** Approximate count for a JQL query; null if Jira can't evaluate it (e.g. index not built yet). */
export async function countJql(jql) {
  try {
    const data = await jiraJson('/rest/api/3/search/approximate-count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql }),
    });
    return data.count;
  } catch {
    return null;
  }
}

// ---------- Links into Jira ----------
export const openInJira = {
  workOrder: (key) => router.navigate(`/browse/${encodeURIComponent(key)}`),
  space: (key) => router.navigate(`/browse/${encodeURIComponent(key)}`),
  search: (jql) => router.navigate(`/issues/?jql=${encodeURIComponent(jql)}`),
};
