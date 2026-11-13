/**
 * Sites: physical places (a plant room, a kitchen line) that hold scans and decisions,
 * each linked to the Jira space where its work orders live.
 *
 * Stored in Forge KVS under `site:<uuid>`. Contract documented in docs/ARCHITECTURE.md §5.2.
 */
import { kvs, WhereConditions } from '@forge/kvs';
import objectStore from '@forge/object-store';
import { randomUUID } from 'node:crypto';

const SITE_PREFIX = 'site:';
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MAX_SCANS_PER_SITE = 50;

/** Trimmed string or throws; enforces a maximum length so records stay small. */
function requiredText(value, field, max) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value, field, max) {
  if (value === undefined || value === null || value === '') return '';
  return requiredText(value, field, max);
}

/**
 * The Jira space (project) a site's work orders live in.
 * The frontend picks it from the user's own project list; we keep the identifying fields only.
 */
function spaceLink(space) {
  if (!space) return null;
  const key = requiredText(space.key, 'Jira space key', 20);
  if (!/^[A-Z][A-Z0-9_]+$/.test(key)) throw new Error(`Invalid Jira space key: ${key}`);
  return {
    id: String(space.id ?? ''),
    key,
    name: optionalText(space.name, 'Jira space name', 120),
    projectTypeKey: optionalText(space.projectTypeKey, 'Jira space type', 40),
  };
}

/** Where a site's equipment list comes from: Jira Assets (by the Assets Site object name), or none. */
function equipmentSource(value) {
  if (!value) return null;
  if (value.kind !== 'assets') throw new Error('Unsupported equipment source');
  return { kind: 'assets', siteName: requiredText(value.siteName, 'Assets site name', 120) };
}

/** A model shipped inside the app (e.g. the sample building), referenced by its path under the workspace resource. */
function bundledModel(value) {
  if (!value) return null;
  if (value.kind !== 'bundled' || !/^models\/[a-z0-9-]+\.glb$/.test(value.path ?? '')) throw new Error('Invalid model');
  return { kind: 'bundled', path: value.path };
}

export async function listSites() {
  const sites = [];
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(SITE_PREFIX)).limit(100);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    sites.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  return sites.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSite(id) {
  if (typeof id !== 'string' || !id) throw new Error('Site id is required');
  const site = await kvs.get(`${SITE_PREFIX}${id}`);
  if (!site) throw new Error('Site not found');
  return site;
}

export async function createSite(input, accountId) {
  const now = new Date().toISOString();
  const site = {
    id: randomUUID(),
    name: requiredText(input?.name, 'Name', MAX_NAME),
    description: optionalText(input?.description, 'Description', MAX_DESCRIPTION),
    space: spaceLink(input?.space),
    equipmentSource: equipmentSource(input?.equipmentSource),
    model: bundledModel(input?.model),
    // Who may approve supersessions. Defaults to the creator; managed later in site Details.
    approvers: accountId ? [accountId] : [],
    scans: [],
    createdAt: now,
    createdBy: accountId ?? null,
    updatedAt: now,
  };
  await kvs.set(`${SITE_PREFIX}${site.id}`, site);
  return site;
}

export async function updateSite(input) {
  const site = await getSite(input?.id);
  if (input.name !== undefined) site.name = requiredText(input.name, 'Name', MAX_NAME);
  if (input.description !== undefined) site.description = optionalText(input.description, 'Description', MAX_DESCRIPTION);
  if (input.space !== undefined) site.space = spaceLink(input.space);
  site.updatedAt = new Date().toISOString();
  await kvs.set(`${SITE_PREFIX}${site.id}`, site);
  return site;
}

/** Removes the site record. Scan objects stay in Object Store (content-addressed, possibly shared). */
export async function deleteSite(id) {
  await getSite(id);
  await kvs.delete(`${SITE_PREFIX}${id}`);
  return { deleted: id };
}

/**
 * Attach an already-uploaded scan (Object Store key) to a site.
 * Verifies the object exists so a site can never point at a missing scan.
 */
export async function addScanToSite(input, accountId) {
  const site = await getSite(input?.siteId);
  const key = requiredText(input?.key, 'Scan key', 200);
  if (!key.startsWith('scans/')) throw new Error('Scan key must be under scans/');
  const stored = await objectStore.get(key);
  if (!stored) throw new Error('Scan not found in storage; upload it first');

  site.scans = (site.scans ?? []).filter((s) => s.key !== key);
  if (site.scans.length >= MAX_SCANS_PER_SITE) throw new Error(`A site can hold at most ${MAX_SCANS_PER_SITE} scans`);
  site.scans.push({
    key,
    fileName: optionalText(input?.fileName, 'File name', 200) || key.split('/').pop(),
    size: stored.size ?? null,
    uploadedAt: new Date().toISOString(),
    uploadedBy: accountId ?? null,
  });
  site.updatedAt = new Date().toISOString();
  await kvs.set(`${SITE_PREFIX}${site.id}`, site);
  return site;
}

/** The 17 MB Scaniverse sample uploaded during spike 1 (present on the dev site only, for now). */
export const SAMPLE_SCAN_KEY = 'scans/sha256-zt-WlSvcMpaRAwzOn2qnh8yVxCRAyeiRdgGr2Va9b1w';

/**
 * Create the sample site ("North Plant Room"), linked to the space the caller chose.
 * Attaches the sample scan when it exists in this installation's Object Store.
 * TODO (install seed): bundle a decimated sample scan so judges' sites get it too.
 */
export async function loadSampleSite(input, accountId) {
  const site = await createSite(
    {
      name: 'North Plant Room',
      description: 'Pump room and HVAC plant. Sample site created by Walkdown so you can explore before scanning your own.',
      space: input?.space ?? null,
    },
    accountId,
  );
  const sample = await objectStore.get(SAMPLE_SCAN_KEY);
  if (!sample) return { site, sampleScanAttached: false };
  const withScan = await addScanToSite(
    { siteId: site.id, key: SAMPLE_SCAN_KEY, fileName: 'north-plant-room.glb' },
    accountId,
  );
  return { site: withScan, sampleScanAttached: true };
}
