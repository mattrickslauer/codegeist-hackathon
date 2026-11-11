/**
 * Precedent backend: the resolver behind every Custom UI `invoke` call.
 * Function inventory and contracts live in docs/ARCHITECTURE.md (the canonical doc).
 */
import Resolver from '@forge/resolver';
import objectStore from '@forge/object-store';
import { addScanToSite, createSite, deleteSite, getSite, listSites, loadSampleSite, updateSite } from './sites';
import api, { route } from '@forge/api';
import { ensureAssetsModel, exbImportPlan, importExbStep, listSiteEquipment, probeAssets } from './assets';
import { approveDecision, createDecision, getDecision, listDecisions, proposeSupersession, withdrawDecision } from './decisions';
import { acknowledgeForIssue, checkWorkOrder, reaffirm, setWorkOrderEquipment } from './check';
import { loadSampleBuilding } from './samples';

/** Bumped by hand when the backend contract changes; the UI shows it so we can confirm which build is live. */
export const BACKEND_VERSION = '0.4.0';

/** Throws unless the signed-in user can see this work order (the check itself runs asApp). */
async function assertCanView(issueKey) {
  if (typeof issueKey !== 'string' || !/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey)) throw new Error('Invalid work order key');
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Work order not found' : `You can't view ${issueKey}`);
}

/** Largest scan we accept (bytes). Object Store allows 1 GB; real phone scans are ~15–25 MB. */
export const MAX_SCAN_BYTES = 200 * 1024 * 1024;

/** Every scan lives under this prefix; download requests for any other key are refused. */
const SCAN_PREFIX = 'scans/';

const resolver = new Resolver();

/**
 * ping: health check for the frontend → backend path.
 * Returns the backend version and the calling user's account ID (from the Forge context, never trusted from the payload).
 */
resolver.define('ping', ({ context }) => ({
  ok: true,
  backendVersion: BACKEND_VERSION,
  accountId: context.accountId ?? null,
  serverTime: new Date().toISOString(),
}));

/** base64 → base64url (no '+', '/', '='), so a checksum can be used safely inside an object key. */
export const base64ToBase64Url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Content-addressed key for a scan: the same bytes always map to the same key. */
export const scanKeyFor = (sha256Base64) => `${SCAN_PREFIX}sha256-${base64ToBase64Url(sha256Base64)}`;

/**
 * getScanUploadUrls: called by the `objectStore.upload` bridge (functionKey).
 * Bridge contract: payload `{ allObjectMetadata: [{ length, checksum, checksumType }] }`
 * → returns `{ [presignedPutUrl]: { key, length, checksum, checksumType } }`.
 * The browser then PUTs each file straight to its URL; file bytes never pass through this function.
 */
resolver.define('getScanUploadUrls', async ({ payload }) => {
  const items = payload?.allObjectMetadata;
  if (!Array.isArray(items) || items.length === 0) throw new Error('allObjectMetadata is required');

  const mapping = {};
  for (const { length, checksum, checksumType } of items) {
    if (checksumType !== 'SHA256') throw new Error(`Unsupported checksum type: ${checksumType}`);
    if (!Number.isInteger(length) || length <= 0 || length > MAX_SCAN_BYTES) {
      throw new Error(`Scan size ${length} bytes is outside the allowed range (1 B – ${MAX_SCAN_BYTES} B)`);
    }
    const key = scanKeyFor(checksum);
    const res = await objectStore.createUploadUrl({ key, length, checksum, checksumType, overwrite: true });
    if (!res?.url) throw new Error(`Object Store returned no upload URL for ${key}`);
    // Spike diagnostics: the host the browser must be allowed to PUT to (needed if Custom UI CSP blocks it).
    console.log(`upload url host=${new URL(res.url).host} key=${key} length=${length}`);
    mapping[res.url] = { key, length, checksum, checksumType };
  }
  return mapping;
});

/**
 * getScanDownloadUrls: called by the `objectStore.download` bridge (functionKey).
 * Bridge contract: payload `{ keys: string[] }` → returns `{ [presignedGetUrl]: key }`.
 */
resolver.define('getScanDownloadUrls', async ({ payload }) => {
  const keys = payload?.keys;
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('keys is required');

  const mapping = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith(SCAN_PREFIX)) throw new Error(`Refusing to sign key outside ${SCAN_PREFIX}`);
    const res = await objectStore.createDownloadUrl(key);
    if (!res?.url) throw new Error(`No object found for ${key}`);
    console.log(`download url host=${new URL(res.url).host} key=${key}`);
    mapping[res.url] = key;
  }
  return mapping;
});

// Sites (KVS). The caller's account ID always comes from the Forge context, never the payload.
resolver.define('listSites', () => listSites());
resolver.define('getSite', ({ payload }) => getSite(payload?.id));
resolver.define('createSite', ({ payload, context }) => createSite(payload, context.accountId));
resolver.define('updateSite', ({ payload }) => updateSite(payload));
resolver.define('deleteSite', ({ payload }) => deleteSite(payload?.id));
resolver.define('addScanToSite', ({ payload, context }) => addScanToSite(payload, context.accountId));
resolver.define('loadSampleSite', ({ payload, context }) => loadSampleSite(payload, context.accountId));

// Jira Assets (spike 4). Runs asApp; each call is one small idempotent step.
resolver.define('assetsProbe', () => probeAssets());
resolver.define('assetsSetup', () => ensureAssetsModel());
resolver.define('assetsImportPlan', () => exbImportPlan());
resolver.define('assetsImportStep', ({ payload }) => importExbStep(payload ?? {}));

// Site equipment (live from Assets, seed fallback).
resolver.define('getSiteEquipment', async ({ payload }) => {
  const site = await getSite(payload?.siteId);
  if (site.equipmentSource?.kind !== 'assets') return { source: 'none', equipment: [] };
  return listSiteEquipment(site.equipmentSource.siteName);
});

// Decisions.
resolver.define('listDecisions', ({ payload }) => listDecisions(payload?.siteId));
resolver.define('createDecision', ({ payload, context }) => createDecision(payload, context.accountId));
resolver.define('withdrawDecision', ({ payload }) => withdrawDecision(payload));
resolver.define('proposeSupersession', async ({ payload, context }) => {
  if (payload?.issueKey) await assertCanView(payload.issueKey);
  return proposeSupersession(payload, context.accountId);
});
resolver.define('approveDecision', async ({ payload, context }) => {
  const result = await approveDecision(payload, context.accountId);
  // The approved replacement was agreed for the work order that raised it: release that work order.
  const origin = result.approved.originIssueKey;
  if (origin) {
    await acknowledgeForIssue(origin, result.approved.id, context.accountId, 'Approved supersession raised from this work order');
    result.recheck = await checkWorkOrder(origin);
  }
  return result;
});
resolver.define('loadSampleBuilding', ({ payload, context }) => loadSampleBuilding(payload, context.accountId));

// Work orders (issue panel).
resolver.define('checkWorkOrder', async ({ payload }) => {
  await assertCanView(payload?.issueKey);
  return checkWorkOrder(payload.issueKey);
});
resolver.define('reaffirmConflict', ({ payload, context }) => reaffirm(payload ?? {}, context.accountId));
resolver.define('setWorkOrderEquipment', ({ payload }) => setWorkOrderEquipment(payload ?? {}));
resolver.define('getDecision', ({ payload }) => getDecision(payload?.siteId, payload?.decisionId));

export const handler = resolver.getDefinitions();

/**
 * Product trigger: a work order was created or updated → run the check (asApp).
 * Self-generated events are filtered in the manifest (ignoreSelf), so our own property writes don't loop.
 */
export async function onWorkOrderEvent(event) {
  const issueKey = event?.issue?.key;
  if (!issueKey) return;
  try {
    const result = await checkWorkOrder(issueKey);
    console.log(`check ${issueKey}: ${result.status}${result.conflicts ? ` (${result.conflicts.length} conflicts)` : ''}`);
  } catch (err) {
    console.error(`check ${issueKey} failed: ${err.message}`);
  }
}
