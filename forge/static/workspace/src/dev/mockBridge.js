/**
 * Local preview only (`npm run dev:mock`): stands in for @forge/bridge so the workspace runs in a plain browser
 * against the sample building, for design work and screenshots. Never bundled into the Forge build.
 * The resolver calls run the same pure graph modules the backend uses.
 */
import seed from '../../../../src/seed/exb-graph.json';
import { applyOps } from '../../../../src/graphEdit.js';

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
];

const handlers = {
  ping: () => ({ ok: true, backendVersion: 'mock' }),
  listSites: () => [site],
  getSite: () => site,
  listDecisions: () => decisions,
  getSiteEquipment: () => ({ source: 'seed', equipment: seed.nodes.filter((n) => n.type === 'Equipment').map((n) => ({ tag: n.name, category: n.attrs.category?.value, level: n.attrs.level?.value })) }),
  getEquipmentContext: () => ({ source: 'none' }),
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
  getContext: async () => ({ extension: { type: 'jira:globalPage' } }),
  theme: { enable: () => {} },
  createHistory: async () => { throw new Error('no history in mock'); },
};
export const requestJira = async () => ({ ok: true, status: 200, json: async () => ({ values: [], issues: [] }), text: async () => '' });
export const router = { navigate: () => {}, open: () => {} };
export const objectStore = { upload: async () => [], download: async () => [] };
export const showFlag = () => {};
