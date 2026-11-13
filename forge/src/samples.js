/**
 * Sample data a new installation can load so there's something real to explore.
 *
 * "Example Office Building" (EXB): an anonymised real 5-storey office building (samples/bim/exb).
 * Its equipment lives in Jira Assets (schema WALK, imported from COBie); the site lists it live from Assets.
 * Three standing decisions are written from the real equipment data so the check has something to enforce.
 */
import seed from './seed/exb.json';
import { createSite } from './sites';
import { createDecision } from './decisions';
import { seedGraph } from './graph';

export const SAMPLE_DECISIONS = [
  {
    statement: 'RTU-1 must not be shut down on weekdays between 06:00 and 19:00.',
    reason: 'RTU-1 is the only air supply for the North tower, levels 2–5 (67,000 CFM). A weekday outage leaves four occupied floors without ventilation. Schedule shutdowns for weekends.',
    equipment: ['RTU-1'],
    guards: ['shut down', 'shutdown', 'power off', 'de-energize', 'lock out', 'lockout', 'isolate', 'disconnect'],
    decidedAt: '2026-03-03T15:00:00.000Z',
  },
  {
    statement: 'Never take both boilers (HWB-1 and HWB-2) out of service at the same time.',
    reason: 'The two boilers are the building\'s only heating hot-water source. One must stay online so the heating loop (HWP-1/HWP-2) keeps running.',
    equipment: ['HWB-1', 'HWB-2'],
    guards: ['out of service', 'offline', 'shut down', 'shutdown', 'drain', 'isolate', 'replace'],
    decidedAt: '2026-01-20T16:30:00.000Z',
  },
  {
    statement: 'Before any work on CU-2, set up temporary cooling for the main electrical room.',
    reason: 'CU-2 serves FCU-1201 in the main electrical room. Without cooling, the switchgear room overheats within hours.',
    equipment: ['CU-2'],
    guards: [],
    decidedAt: '2026-05-12T14:00:00.000Z',
  },
];

/** Create the EXB sample site linked to `space`, with its standing decisions. */
export async function loadSampleBuilding(input, accountId) {
  const site = await createSite(
    {
      name: seed.building.name,
      description: 'Anonymised 5-storey office building with a parking structure. Equipment from its as-built COBie, kept in Jira Assets.',
      space: input?.space ?? null,
      equipmentSource: { kind: 'assets', siteName: seed.building.name },
      model: { kind: 'bundled', path: 'models/exb.glb' },
    },
    accountId,
  );
  const decisions = [];
  for (const d of SAMPLE_DECISIONS) decisions.push(await createDecision({ ...d, siteId: site.id }, accountId));
  const graph = await seedGraph(site.id);
  return { site, decisions, graph };
}
