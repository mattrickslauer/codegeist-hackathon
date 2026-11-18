/**
 * Local preview only (`npm run dev:mock`): stands in for @forge/bridge so the workspace runs in a plain browser
 * against the sample building, for design work and screenshots. Never bundled into the Forge build.
 * The resolver calls run the same pure graph modules the backend uses.
 */
import seed from '../../../../src/seed/exb-graph.json';
import { applyOps } from '../../../../src/graphEdit.js';
import { context, indexGraph } from '../../../../src/graphWalk.js';

// ?empty shows the first-run screen; ?panel=FAC-101 renders the work-order panel instead of the workspace.
const params = new URLSearchParams(window.location.search);

const now = () => new Date().toISOString();
const site = {
  id: 'sample', name: 'Example Office Building', description: 'Five-storey office building (sample data)',
  space: { key: 'FAC', name: 'Facilities', avatarUrl: null }, model: { kind: 'bundled', path: 'models/exb.glb' },
  equipmentSource: { kind: 'assets', siteName: 'Example Office Building' }, scans: [], approvers: [],
};
let graph = { ...structuredClone(seed), rev: 0 };
let log = [];
const decisions = [
  { id: 'd1', siteId: 'sample', status: 'standing', statement: 'RTU-1 must not be shut down on weekdays 06:00–19:00', reason: 'Only air supply for four floors.', equipment: ['RTU-1'], guards: ['shut down'], decidedAt: '2026-10-02T10:00:00Z' },
  { id: 'd2', siteId: 'sample', status: 'standing', statement: 'Boilers HWB-1 and HWB-2 are never both out of service', reason: 'Redundancy for heating.', equipment: ['HWB-1', 'HWB-2'], guards: [], decidedAt: '2026-10-05T10:00:00Z' },
  { id: 'd3', siteId: 'sample', status: 'proposed', supersedes: 'd2', statement: 'One boiler may be out of service May–September with 24 h notice', reason: 'No heating load in summer; lets us service both boilers.', equipment: ['HWB-1', 'HWB-2'], guards: [], decidedAt: '2026-11-14T10:00:00Z', originIssueKey: 'FAC-104' },
];

const conflictRtu1 = { decisionId: 'd1', siteId: 'sample', statement: decisions[0].statement, reason: decisions[0].reason, equipment: ['RTU-1'], matched: ['RTU-1'], guardsMatched: ['shut down'], decidedBy: 'acc-1', decidedAt: decisions[0].decidedAt, pin: null };
const checks = {
  'FAC-101': { version: 1, status: 'conflict', siteId: 'sample', summary: decisions[0].statement, touched: ['RTU-1'], conflicts: [conflictRtu1], acknowledged: [], checkedAt: now() },
  'FAC-102': { version: 1, status: 'clear', siteId: 'sample', summary: null, touched: ['RTU-2'], conflicts: [], acknowledged: [], checkedAt: now() },
  'FAC-103': { version: 1, status: 'clear', siteId: 'sample', summary: null, touched: ['CU-2'], conflicts: [], acknowledged: [], checkedAt: now() },
};
const issues = [
  { key: 'FAC-101', summary: 'Shut down RTU-1 Tuesday 10:00 for coil cleaning', status: 'Open', cat: 'new', updated: '2026-11-16T15:00:00Z' },
  { key: 'FAC-102', summary: 'Quote: replace RTU-2 with a larger unit', status: 'In Progress', cat: 'indeterminate', updated: '2026-11-15T12:00:00Z' },
  { key: 'FAC-103', summary: 'CU-2 filter change', status: 'Open', cat: 'new', updated: '2026-11-14T09:00:00Z' },
  { key: 'FAC-105', summary: 'Lobby light flickering', status: 'Open', cat: 'new', updated: '2026-11-13T09:00:00Z' },
];

const handlers = {
  ping: () => ({ ok: true, backendVersion: 'mock' }),
  listSites: () => (params.has('empty') ? [] : [site]),
  loadSampleBuilding: () => ({ site, decisions, graph }),
  checkWorkOrder: ({ issueKey }) => checks[issueKey] ?? { version: 1, status: 'clear', siteId: 'sample', touched: [], conflicts: [], acknowledged: [], checkedAt: now() },
  reaffirmConflict: ({ issueKey, reason }) => {
    const c = checks[issueKey];
    checks[issueKey] = { ...c, status: 'clear', conflicts: [], acknowledged: c.conflicts.map((x) => ({ ...x, resolution: { type: 'reaffirm', reason, by: 'me', at: now() } })) };
    return checks[issueKey];
  },
  proposeSupersession: () => ({ ok: true }),
  approveDecision: () => ({ approved: true }),
  withdrawDecision: () => ({ ok: true }),
  createDecision: (d) => { const x = { id: `d${decisions.length + 1}`, status: 'standing', decidedAt: now(), ...d }; decisions.unshift(x); return x; },
  getSite: () => site,
  listDecisions: () => decisions,
  getSiteEquipment: () => ({ source: 'seed', equipment: seed.nodes.filter((n) => n.type === 'Equipment').map((n) => ({ tag: n.name, category: n.attrs.category?.value, level: n.attrs.level?.value })) }),
  getEquipmentContext: ({ tag }) => ({ source: 'graph', context: context(indexGraph(graph), tag) }),
  getSiteGraph: () => ({ graph }),
  startSiteGraph: () => ({ graph }),
  editSiteGraph: ({ rev, ops, label }) => {
    if (rev !== graph.rev) throw new Error('Someone else just changed this site’s connections.');
    const r = applyOps(graph, ops, 'me', now());
    graph = r.graph;
    log.unshift({ rev: graph.rev, at: now(), by: 'me', label: label ?? 'Edit', count: ops.length, inverse: r.inverse });
    return { graph, touched: r.touched };
  },
  undoSiteGraph: () => {
    const e = log.find((x) => x.inverse && !x.undone);
    if (!e) throw new Error('Nothing to undo');
    graph = applyOps(graph, e.inverse, 'me', now()).graph;
    e.undone = true;
    log.unshift({ rev: graph.rev, at: now(), by: 'me', label: `Undo: ${e.label}`, count: e.inverse.length, inverse: null });
    return { graph };
  },
  graphHistory: () => log.map(({ inverse, ...e }) => ({ ...e, undoable: Boolean(inverse) && !e.undone })),
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export async function invoke(name, payload) {
  await delay(120);
  const fn = handlers[name];
  if (!fn) throw new Error(`mock: no resolver ${name}`);
  return structuredClone(fn(payload ?? {}));
}

export const view = {
  getContext: async () => (params.get('panel') ? { extension: { type: 'jira:issuePanel', issue: { key: params.get('panel') } } } : { extension: { type: 'jira:globalPage' } }),
  theme: { enable: () => {} },
  createHistory: async () => { throw new Error('no history in mock'); },
};
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
export const requestJira = async (path) => {
  if (path.startsWith('/rest/api/3/project/search')) return json({ values: [{ id: '1', key: 'FAC', name: 'Facilities', projectTypeKey: 'service_desk' }] });
  if (path.startsWith('/rest/api/3/search/approximate-count')) return json({ count: 1 });
  if (path.startsWith('/rest/api/3/search/jql')) {
    return json({ issues: issues.map((i) => ({ key: i.key, fields: { summary: i.summary, status: { name: i.status, statusCategory: { key: i.cat } }, issuetype: { name: 'Task' }, updated: i.updated }, properties: checks[i.key] ? { 'walkdown.check': checks[i.key] } : {} })) });
  }
  return json({ values: [], issues: [] });
};
export const router = { navigate: () => {}, open: () => {} };
export const objectStore = { upload: async () => [], download: async () => [] };
export const showFlag = () => {};
